// controllers/notificationController.js

const Notification = require('../models/notificationModel');
const asyncHandler = require('express-async-handler');
const statusCodes = require('../constants/statusCodes');

// Get user's notifications with pagination and filters
exports.getUserNotifications = asyncHandler(async (req, res) => {
    try {
      const { page = 1, limit = 10, isRead } = req.query;
      const userId = req.user.id;
  
      // Build query for user's notifications only
      let query = { recipient: userId };
      if (typeof isRead === 'boolean') {
        query.isRead = isRead;
      }
  
      const notifications = await Notification.find(query)
        .populate({
          path: 'data.reportId',
          select: 'type status personInvolved.firstName personInvolved.lastName'
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

// Mark all notifications as read
exports.markAllAsRead = asyncHandler(async (req, res) => {
  try {
    const userId = req.user.id;

    await Notification.updateMany(
      { recipient: userId, isRead: false },
      { isRead: true }
    );

    res.status(statusCodes.OK).json({
      success: true,
      msg: 'All notifications marked as read'
    });
  } catch (error) {
    console.error('Error marking all notifications as read:', error);
    res.status(statusCodes.INTERNAL_SERVER_ERROR).json({
      success: false,
      msg: 'Error updating notifications',
      error: error.message
    });
  }
});