const Notification = require('../models/notificationModel');
const asyncHandler = require('express-async-handler');
const statusCodes = require('../constants/statusCodes');
const broadcastTypes = require('../utils/notificationTemplates');
// Get user's notifications with pagination and filters
exports.getUserNotifications = asyncHandler(async (req, res) => {
  try {
    const { page = 1, limit = 10, isRead, type } = req.query;
    const userId = req.user.id;

    let query = { recipient: userId };
    
    if (typeof isRead === 'boolean') {
      query.isRead = isRead;
    }

    if (type) {
      query.type = type;
    }

    const notifications = await Notification.find(query)
      .populate({
        path: 'data.reportId',
        select: 'type status personInvolved.firstName personInvolved.lastName location.address'
      })
      .sort('-createdAt')
      .skip((page - 1) * limit)
      .limit(parseInt(limit));

    const total = await Notification.countDocuments(query);

    res.status(statusCodes.OK).json({
      success: true,
      data: {
        notifications,
        currentPage: parseInt(page),
        totalPages: Math.ceil(total / limit),
        totalNotifications: total,
        hasMore: page * limit < total
      }
    });

  } catch (error) {
    console.error('Error fetching notifications:', error);
    res.status(statusCodes.INTERNAL_SERVER_ERROR).json({
      success: false,
      msg: 'Error retrieving notifications',
      error: error.message
    });
  }
});

// Create broadcast notification for users in scope
exports.createBroadcastNotification = async ({ body, user }) => {
  try {
    const { reportId, recipients, broadcastType, scope, report } = body;

    if (!report) {
      return {
        success: false,
        msg: 'Report data is required'
      };
    }

    // Create notifications without template dependency
    const notificationPromises = recipients.map(userId => 
      Notification.create({
        recipient: userId,
        type: 'BROADCAST_ALERT',
        title: `${report.type || 'Missing Person'} Alert`,
        message: `A new ${broadcastType} alert has been broadcast in your area`,
        data: {
          reportId,
          broadcastType,
          scope,
          broadcastedBy: user?.id,
          reportType: report.type,
          reportDetails: {
            location: report.location,
            type: report.type,
            status: report.status,
            personInvolved: {
              name: `${report.personInvolved.firstName} ${report.personInvolved.lastName}`,
              age: report.personInvolved.age,
              lastSeen: report.personInvolved.lastSeenDate
            }
          }
        }
      })
    );

    await Promise.all(notificationPromises);

    return {
      success: true,
      msg: `Created ${recipients.length} notifications`
    };

  } catch (error) {
    console.error('Notification creation error:', error);
    return {
      success: false,
      msg: 'Failed to create notifications',
      error: error.message
    };
  }
};

// Mark notification as read
exports.markAsRead = asyncHandler(async (req, res) => {
  try {
    const { notificationId } = req.params;
    const userId = req.user.id;

    const notification = await Notification.findOneAndUpdate(
      { _id: notificationId, recipient: userId },
      { isRead: true },
      { new: true }
    );

    if (!notification) {
      return res.status(statusCodes.NOT_FOUND).json({
        success: false,
        msg: 'Notification not found'
      });
    }

    res.status(statusCodes.OK).json({
      success: true,
      data: notification
    });
  } catch (error) {
    console.error('Error marking notification as read:', error);
    res.status(statusCodes.INTERNAL_SERVER_ERROR).json({
      success: false,
      msg: 'Error updating notification',
      error: error.message
    });
  }
});

// Get notification details by ID
exports.getNotificationDetails = asyncHandler(async (req, res) => {
  try {
    const { notificationId } = req.params;
    const userId = req.user.id;

    const notification = await Notification.findOne({ 
      _id: notificationId, 
      recipient: userId 
    })
    .populate({
      path: 'data.reportId',
      select: 'type status personInvolved location additionalImages createdAt updatedAt',
      populate: {
        path: 'assignedPoliceStation',
        select: 'name address contactNumber'
      }
    })
    .populate({
      path: 'data.finderReportId',
      select: 'discoveryDetails personCondition images authoritiesNotified status',
      populate: {
        path: 'finder',
        select: 'firstName lastName number email'
      }
    });

    if (!notification) {
      return res.status(statusCodes.NOT_FOUND).json({
        success: false,
        msg: 'Notification not found'
      });
    }

    // Format notification content based on type
    let formattedContent;
    switch (notification.type) {
      case 'REPORT_CREATED':
      case 'STATUS_UPDATED':
      case 'ASSIGNED_OFFICER':
        formattedContent = {
          ...notification._doc,
          reportDetails: notification.data.reportId,
          assignedStation: notification.data.reportId?.assignedPoliceStation
        };
        break;

      case 'FINDER_REPORT':
        formattedContent = {
          ...notification._doc,
          finderDetails: notification.data.finderReportId,
          originalReport: notification.data.reportId
        };
        break;

      case 'BROADCAST_ALERT':
        formattedContent = {
          ...notification._doc,
          reportDetails: notification.data.reportId,
          broadcastInfo: {
            type: notification.data.broadcastType,
            scope: notification.data.scope
          }
        };
        break;

      default:
        formattedContent = notification;
    }

    // Mark notification as read
    if (!notification.isRead) {
      notification.isRead = true;
      await notification.save();
    }

    res.status(statusCodes.OK).json({
      success: true,
      data: formattedContent
    });

  } catch (error) {
    console.error('Error fetching notification details:', error);
    res.status(statusCodes.INTERNAL_SERVER_ERROR).json({
      success: false,
      msg: 'Error retrieving notification details',
      error: error.message
    });
  }
});
