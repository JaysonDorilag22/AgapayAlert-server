const Report = require('../models/reportModel');
const User = require('../models/userModel');
const asyncHandler = require('express-async-handler');
const statusCodes = require('../constants/statusCodes');
const { sendOneSignalNotification, sendSMSNotification } = require('../utils/notificationUtils');
const { createFacebookPost, deleteFacebookPost } = require('../utils/broadcastUtils');
const notificationController = require('./notificationController')
const axios = require('axios');
const broadcastTemplates = require('../utils/contentTemplates');

// Publish Report
exports.publishReport = asyncHandler(async (req, res) => {
  try {
    const { reportId } = req.params;
    const { 
      broadcastType,    
      scheduledDate,
      scope = {
        type: 'city',   
        city: null,     
        radius: null    
      }
    } = req.body;

    // 1. Validate Report
    const report = await Report.findById(reportId);
    if (!report) {
      return res.status(statusCodes.NOT_FOUND).json({
        success: false,
        msg: 'Report not found'
      });
    }

    if (!report.broadcastConsent) {
      return res.status(statusCodes.BAD_REQUEST).json({
        success: false,
        msg: 'No broadcast consent given for this report'
      });
    }

    // 2. Get Target Users
    let targetUsers = [];
    switch(scope.type) {
      case 'city':
        targetUsers = await User.find({
          'address.city': scope.city,
          deviceToken: { $exists: true, $ne: null }
        });
        break;

      case 'radius':
        targetUsers = await User.find({
          'address.location': {
            $near: {
              $geometry: {
                type: 'Point',
                coordinates: report.location.coordinates
              },
              $maxDistance: scope.radius * 1000
            }
          },
          deviceToken: { $exists: true, $ne: null }
        });
        break;

      case 'all':
        targetUsers = await User.find({
          deviceToken: { $exists: true, $ne: null }
        });
        break;
    }

    // 3. Get Content from Templates
    const pushContent = broadcastTemplates.report(report);
    const smsContent = broadcastTemplates.sms(report);
    const fbContent = broadcastTemplates.facebook(report);

    // 4. Handle Scheduling
    if (scheduledDate) {
      report.publishSchedule = {
        scheduledDate: new Date(scheduledDate),
        channels: broadcastType === 'all' ? 
          ["Push Notification", "SMS", "Facebook Post"] : 
          [broadcastType]
      };
      await report.save();

      return res.status(statusCodes.OK).json({
        success: true,
        msg: 'Broadcast scheduled successfully',
        scheduledDate: report.publishSchedule.scheduledDate
      });
    }

    // 5. Execute Broadcast
    let broadcastResults = {};
    const broadcastRecord = {
      date: new Date(),
      action: 'published',
      method: [],
      publishedBy: req.user.id,
      scope: scope,
      targetedUsers: targetUsers.length,
      deliveryStats: {
        push: 0,
        sms: 0,
        facebook: 0
      }
    };

    switch(broadcastType) {
      case 'Push Notification':
        const deviceIds = targetUsers.map(user => user.deviceToken).filter(Boolean);
        if (deviceIds.length > 0) {
          broadcastResults.push = await sendOneSignalNotification({
            ...pushContent,
            include_player_ids: deviceIds,
            data: { 
              reportId: report._id,
              type: report.type,
              image: report.personInvolved.mostRecentPhoto.url
            }
          });
          broadcastRecord.deliveryStats.push = deviceIds.length;
        }
        broadcastRecord.method.push('Push Notification');
        break;

      case 'SMS':
        const phones = targetUsers.map(user => user.number).filter(Boolean);
        broadcastResults.sms = await sendSMSNotification({
          phones,
          message: smsContent.message
        });
        broadcastRecord.method.push('SMS');
        broadcastRecord.deliveryStats.sms = phones.length;
        break;

      case 'Facebook Post':
        broadcastResults.facebook = await createFacebookPost(fbContent);
        broadcastRecord.method.push('Facebook Post');
        broadcastRecord.deliveryStats.facebook = 1;
        break;

      case 'all':
        const allDeviceIds = targetUsers.map(user => user.deviceToken).filter(Boolean);
        const [pushResult, smsResult, fbResult] = await Promise.all([
          allDeviceIds.length > 0 ? sendOneSignalNotification({
            ...pushContent,
            include_player_ids: allDeviceIds,
            data: { 
              reportId: report._id,
              type: report.type,
              image: report.personInvolved.mostRecentPhoto.url
            }
          }) : { success: false, msg: 'No valid device tokens' },
          sendSMSNotification({
            phones: targetUsers.map(u => u.number).filter(Boolean),
            message: smsContent.message
          }),
          createFacebookPost(fbContent)
        ]);

        broadcastResults = { push: pushResult, sms: smsResult, facebook: fbResult };
        broadcastRecord.method = ["Push Notification", "SMS", "Facebook Post"];
        broadcastRecord.deliveryStats = {
          push: allDeviceIds.length,
          sms: targetUsers.filter(u => u.number).length,
          facebook: 1
        };
        break;

      default:
        return res.status(statusCodes.BAD_REQUEST).json({
          success: false,
          msg: 'Invalid broadcast type'
        });
    }

    // 6. Create In-App Notifications
    if (targetUsers.length > 0) {
      try {
        const notificationResult = await notificationController.createBroadcastNotification({
          body: {
            reportId: report._id,
            recipients: targetUsers.map(user => user._id),
            broadcastType,
            scope
          },
          user: req.user
        });

        if (!notificationResult.success) {
          console.error('Notification creation failed:', notificationResult.msg);
        }
      } catch (error) {
        console.error('Notification error:', error);
      }
    }

    // 7. Update Report & Save
    report.isPublished = true;
    report.broadcastHistory.push(broadcastRecord);
    await report.save();

    res.status(statusCodes.OK).json({
      success: true,
      msg: 'Report broadcast successfully',
      stats: {
        targetedUsers: targetUsers.length,
        deliveryStats: broadcastRecord.deliveryStats,
        scope: scope
      },
      results: broadcastResults
    });

  } catch (error) {
    console.error('Broadcasting error:', error);
    res.status(statusCodes.INTERNAL_SERVER_ERROR).json({
      success: false,
      msg: 'Error broadcasting report',
      error: error.message
    });
  }
});

// Unpublish Report
exports.unpublishReport = asyncHandler(async (req, res) => {
  try {
    const { reportId } = req.params;
    const { channels = [] } = req.body;

    const report = await Report.findById(reportId);
    if (!report) {
      return res.status(statusCodes.NOT_FOUND).json({
        success: false,
        msg: 'Report not found'
      });
    }

    // Find latest broadcast record
    const latestBroadcast = report.broadcastHistory[report.broadcastHistory.length - 1];
    
    if (latestBroadcast?.method.includes('Facebook Post') && latestBroadcast.facebookPostId) {
      try {
        await deleteFacebookPost(latestBroadcast.facebookPostId);
      } catch (fbError) {
        console.error('Error deleting Facebook post:', fbError);
      }
    }

    // Add unpublish record
    report.broadcastHistory.push({
      date: new Date(),
      action: 'unpublished',
      method: channels,
      publishedBy: req.user.id
    });

    report.isPublished = false;
    await report.save();

    res.status(statusCodes.OK).json({
      success: true,
      msg: 'Report unpublished successfully'
    });

  } catch (error) {
    console.error('Error unpublishing report:', error);
    res.status(statusCodes.INTERNAL_SERVER_ERROR).json({
      success: false,
      msg: 'Error unpublishing report',
      error: error.message
    });
  }
});

// Get Broadcast History
exports.getBroadcastHistory = asyncHandler(async (req, res) => {
  try {
    const { reportId } = req.params;
    
    const report = await Report.findById(reportId)
      .populate('broadcastHistory.publishedBy', 'firstName lastName');

    if (!report) {
      return res.status(statusCodes.NOT_FOUND).json({
        success: false,
        msg: 'Report not found'
      });
    }

    res.status(statusCodes.OK).json({
      success: true,
      data: {
        history: report.broadcastHistory,
        schedule: report.publishSchedule
      }
    });

  } catch (error) {
    console.error('Error fetching broadcast history:', error);
    res.status(statusCodes.INTERNAL_SERVER_ERROR).json({
      success: false,
      msg: 'Error retrieving broadcast history',
      error: error.message
    });
  }
});

// In broadcastController.js
exports.testAdminNotification = asyncHandler(async (req, res) => {
  try {
    // 1. Find admin users with device tokens
    const adminUsers = await User.find({ 
      roles: 'city_admin',
      deviceToken: { $exists: true, $ne: null }
    });

    if (!adminUsers.length) {
      return res.status(statusCodes.NOT_FOUND).json({
        success: false,
        msg: 'No city admin users found with device tokens'
      });
    }

    // 2. Setup notification with filters
    const notification = {
      app_id: process.env.ONESIGNAL_APP_ID,
      filters: [
        {
          field: "tag",
          key: "role",
          relation: "=",
          value: "city_admin"
        }
      ],
      contents: { 
        en: "Test notification for city admins only" 
      },
      headings: { 
        en: "Admin Test Alert" 
      }
    };

    // 3. Send notification
    const response = await axios.post(
      'https://onesignal.com/api/v1/notifications',
      notification,
      {
        headers: {
          'Authorization': `Basic ${process.env.ONESIGNAL_API_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );

    // 4. Return results
    res.status(statusCodes.OK).json({
      success: true,
      stats: {
        adminsFound: adminUsers.length,
        deviceTokens: adminUsers.map(u => u.deviceToken)
      },
      notification: response.data
    });

  } catch (error) {
    console.error('Notification error:', error.response?.data || error);
    res.status(statusCodes.INTERNAL_SERVER_ERROR).json({
      success: false,
      error: error.response?.data || error.message
    });
  }
});