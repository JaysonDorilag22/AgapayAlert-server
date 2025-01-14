const Notification = require('../models/notificationModel');
const asyncHandler = require('express-async-handler');
const statusCodes = require('../constants/statusCodes');

// Get user's notifications with pagination and filters
exports.getUserNotifications = asyncHandler(async (req, res) => {
  try {
    const { page = 1, limit = 10, isRead, type } = req.query;
    const userId = req.user.id;

    // Build query for user's notifications
    let query = { recipient: userId };
    
    // Add read/unread filter
    if (typeof isRead === 'boolean') {
      query.isRead = isRead;
    }

    // Add type filter
    if (type) {
      query.type = type;
    }

    const notifications = await Notification.find(query)
      .populate({
        path: 'data.reportId',
        select: 'type status personInvolved.firstName personInvolved.lastName location.address'
      })
      .populate('data.broadcastedBy', 'firstName lastName roles')
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
    const { reportId, recipients, broadcastType, scope } = body;

    const notificationPromises = recipients.map(userId => 
      Notification.create({
        recipient: userId,
        type: 'BROADCAST_ALERT',
        title: 'Missing Person Alert',
        message: `A new ${broadcastType} alert has been broadcast in your area`,
        data: {
          reportId,
          broadcastType,
          scope,
          broadcastedBy: user?.id
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