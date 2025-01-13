const Report = require('../models/reportModel');
const User = require('../models/userModel');
const asyncHandler = require('express-async-handler');
const statusCodes = require('../constants/statusCodes');
const { sendOneSignalNotification, sendSMSNotification } = require('../utils/notificationUtils');
const { createFacebookPost, deleteFacebookPost } = require('../utils/broadcastUtils');
const notificationController = require('./notificationController')
const axios = require('axios');
// Publish Report
exports.publishReport = asyncHandler(async (req, res) => {
  try {
    const { reportId } = req.params;
    const { 
      broadcastType,    // 'push', 'sms', 'facebook', 'all'
      scheduledDate,
      scope = {
        type: 'city',   // 'city', 'radius', 'all'
        city: null,     
        radius: null    // in kilometers
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
          'preferredNotifications.push': true
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
          'preferredNotifications.push': true
        });
        break;

      case 'all':
        targetUsers = await User.find({
          'preferredNotifications.push': true
        });
        break;
    }

    // 3. Format Content
    const broadcastContent = {
      title: `${report.type} Alert`,
      message: `URGENT: Please help us locate
      
${report.personInvolved.firstName} ${report.personInvolved.lastName}
Age: ${report.personInvolved.age}
Last Seen: ${new Date(report.personInvolved.lastSeenDate).toLocaleDateString()} at ${report.personInvolved.lastSeentime}
Location: ${report.personInvolved.lastKnownLocation}`,
      image: report.personInvolved.mostRecentPhoto.url
    };

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
        broadcastResults.push = await sendOneSignalNotification({
          title: broadcastContent.title,
          message: broadcastContent.message,
          data: { 
            reportId: report._id,
            type: report.type,
            image: broadcastContent.image
          }
        });
        broadcastRecord.method.push('Push Notification');
        broadcastRecord.deliveryStats.push = targetUsers.length;
        break;

      case 'SMS':
        const phones = targetUsers.map(user => user.number).filter(Boolean);
        broadcastResults.sms = await sendSMSNotification({
          phones,
          message: broadcastContent.message
        });
        broadcastRecord.method.push('SMS');
        broadcastRecord.deliveryStats.sms = phones.length;
        break;

      case 'Facebook Post':
        broadcastResults.facebook = await createFacebookPost({
          message: broadcastContent.message,
          image: broadcastContent.image
        });
        broadcastRecord.method.push('Facebook Post');
        broadcastRecord.deliveryStats.facebook = 1;
        break;

      case 'all':
        const [pushResult, smsResult, fbResult] = await Promise.all([
          sendOneSignalNotification({
            title: broadcastContent.title,
            message: broadcastContent.message,
            data: { 
              reportId: report._id,
              type: report.type,
              image: broadcastContent.image
            }
          }),
          sendSMSNotification({
            phones: targetUsers.map(u => u.number).filter(Boolean),
            message: broadcastContent.message
          }),
          createFacebookPost({
            message: broadcastContent.message,
            image: broadcastContent.image
          })
        ]);

        broadcastResults = { 
          push: pushResult, 
          sms: smsResult, 
          facebook: fbResult 
        };
        
        broadcastRecord.method = ["Push Notification", "SMS", "Facebook Post"];
        broadcastRecord.deliveryStats = {
          push: targetUsers.length,
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
      await notificationController.createBroadcastNotification({
        body: {
          reportId: report._id,
          recipients: targetUsers.map(user => user._id),
          broadcastType,
          scope
        },
        user: req.user
      });
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