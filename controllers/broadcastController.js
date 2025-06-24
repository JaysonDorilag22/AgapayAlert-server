const Report = require("../models/reportModel");
const User = require("../models/userModel");
const asyncHandler = require("express-async-handler");
const statusCodes = require("../constants/statusCodes");
const { sendOneSignalNotification } = require("../utils/notificationUtils");
const { createFacebookPost, deleteFacebookPost } = require("../utils/broadcastUtils");
const notificationController = require("./notificationController");
const axios = require("axios");
const { broadcastTemplates } = require("../utils/contentTemplates");
const { NOTIFICATION_SOUNDS } = require("../constants/alertSound");
const { sendMessengerBroadcast } = require('../utils/messengerUtils');
// Publish Report
exports.publishReport = asyncHandler(async (req, res) => {
  try {
    const { reportId } = req.params;
    const {
      broadcastType,
      scope = { type: "city", city: null, radius: null }
    } = req.body;
    console.log("Report ID:", reportId);
    console.log("Broadcast Type:", broadcastType);
    console.log("Scope:", scope);

    // 1. Validate Report
    const report = await Report.findById(reportId);
    if (!report) {
      return res.status(statusCodes.NOT_FOUND).json({
        success: false,
        msg: "Report not found"
      });
    }

    if (!report.broadcastConsent) {
      return res.status(statusCodes.BAD_REQUEST).json({
        success: false,
        msg: "No broadcast consent given for this report"
      });
    }

    // 2. Get Target Users
    let targetUsers = [];
    switch (scope.type) {
      case "city":
        targetUsers = await User.find({
          "address.city": scope.city,
          deviceToken: { $exists: true, $ne: null }
        });
        break;

      case "radius":
        targetUsers = await User.find({
          "address.location": {
            $near: {
              $geometry: {
                type: "Point",
                coordinates: report.location.coordinates
              },
              $maxDistance: scope.radius * 1000
            }
          },
          deviceToken: { $exists: true, $ne: null }
        });
        break;

      case "all":
        targetUsers = await User.find({
          deviceToken: { $exists: true, $ne: null }
        });
        break;
    }

    // 3. Get Content Templates
    const pushContent = broadcastTemplates.report(report);
    const fbContent = broadcastTemplates.facebook(report);
    const messengerContent = broadcastTemplates.messenger(report);

    // 4. Initialize Broadcast Record
    let broadcastResults = {};
    const broadcastRecord = {
      date: new Date(),
      action: "published",
      method: [],
      publishedBy: req.user.id,
      scope: scope,
      targetedUsers: targetUsers.length,
      deliveryStats: {
        push: 0,
        messenger: 0,
        facebook: 0
      }
    };

    // 5. Execute Broadcast
    switch (broadcastType) {
      case "Push Notification":
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
        broadcastRecord.method.push("Push Notification");
        break;

      case "Messenger":
        // Send to Messenger subscribers
        const messengerBroadcast = await sendMessengerBroadcast(report);
        broadcastResults.messenger = messengerBroadcast;
        if (messengerBroadcast.success) {
          broadcastRecord.method.push("Messenger");
          broadcastRecord.deliveryStats.messenger = messengerBroadcast.count;
          broadcastRecord.notes = "Messenger broadcast sent successfully";
        } else {
          broadcastRecord.notes = `Messenger broadcast failed: ${messengerBroadcast.error}`;
        }
        break;

      case "Facebook Post":
        try {
          const fbBroadcast = await createFacebookPost(report);
          broadcastResults.facebook = fbBroadcast;
          if (fbBroadcast.success) {
            broadcastRecord.method.push("Facebook Post");
            broadcastRecord.deliveryStats.facebook = 1;
            broadcastRecord.facebookPostId = fbBroadcast.postId;
            broadcastRecord.notes = "Posted successfully to Facebook page";
          } else {
            broadcastRecord.notes = `Facebook post failed: ${fbBroadcast.error}`;
          }
        } catch (error) {
          console.error("Facebook post error:", error);
          broadcastRecord.notes = `Facebook post error: ${error.message}`;
        }
        break;

      case "all":
        // Execute all broadcast types simultaneously
        const allDeviceIds = targetUsers.map(user => user.deviceToken).filter(Boolean);
        const [pushBroadcast, msgBroadcast, fbBroadcast] = await Promise.all([
          allDeviceIds.length > 0
            ? sendOneSignalNotification({
                ...pushContent,
                include_player_ids: allDeviceIds,
                data: {
                  reportId: report._id,
                  type: report.type,
                  image: report.personInvolved.mostRecentPhoto.url
                }
              })
            : { success: false, msg: "No valid device tokens" },
          sendMessengerBroadcast(report),
          createFacebookPost(report)
        ]);

        broadcastResults = {
          push: pushBroadcast,
          messenger: msgBroadcast,
          facebook: fbBroadcast
        };

        broadcastRecord.method = ["Push Notification", "Messenger", "Facebook Post"];
        broadcastRecord.deliveryStats = {
          push: allDeviceIds.length,
          messenger: msgBroadcast.success ? msgBroadcast.count : 0,
          facebook: fbBroadcast.success ? 1 : 0
        };

        if (fbBroadcast.success) {
          broadcastRecord.facebookPostId = fbBroadcast.postId;
        }
        break;

      default:
        return res.status(statusCodes.BAD_REQUEST).json({
          success: false,
          msg: "Invalid broadcast type"
        });
    }

    // 6. Create In-App Notifications
    if (targetUsers.length > 0) {
      try {
        await notificationController.createBroadcastNotification({
          body: {
            reportId: report._id,
            recipients: targetUsers.map(user => user._id),
            broadcastType,
            scope,
            report: {
              type: report.type,
              location: report.location,
              status: report.status,
              personInvolved: report.personInvolved
            }
          },
          user: req.user
        });
      } catch (error) {
        console.error("Notification error:", error);
      }
    }

    // 7. Update Report & Save
    report.isPublished = true;
    report.broadcastHistory.push(broadcastRecord);
    await report.save();

    // 8. Send Response
    res.status(statusCodes.OK).json({
      success: true,
      msg: "Report broadcast successfully",
      stats: {
        targetedUsers: targetUsers.length,
        deliveryStats: broadcastRecord.deliveryStats,
        scope: scope
      },
      results: broadcastResults
    });

  } catch (error) {
    console.error("Broadcasting error:", error);
    res.status(statusCodes.INTERNAL_SERVER_ERROR).json({
      success: false,
      msg: "Error broadcasting report",
      error: error.message
    });
  }
});

// Unpublish Report
exports.unpublishReport = asyncHandler(async (req, res) => {
  try {
    const { reportId } = req.params;
    const report = await Report.findById(reportId);

    if (!report) {
      return res.status(statusCodes.NOT_FOUND).json({
        success: false,
        msg: "Report not found",
      });
    }

    const latestBroadcast = report.broadcastHistory[report.broadcastHistory.length - 1];

    if (latestBroadcast?.method.includes("Facebook Post") && latestBroadcast.facebookPostId) {
      try {
        await deleteFacebookPost(latestBroadcast.facebookPostId);
      } catch (fbError) {
        console.error("Error deleting Facebook post:", fbError);
      }
    }

    report.broadcastHistory.push({
      date: new Date(),
      action: "unpublished",
      publishedBy: req.user.id,
    });

    report.isPublished = false;
    await report.save();

    res.status(statusCodes.OK).json({
      success: true,
      msg: "Report unpublished successfully",
    });
  } catch (error) {
    console.error("Error unpublishing report:", error);
    res.status(statusCodes.INTERNAL_SERVER_ERROR).json({
      success: false,
      msg: "Error unpublishing report",
      error: error.message,
    });
  }
});

// Get Broadcast History
exports.getBroadcastHistory = asyncHandler(async (req, res) => {
  try {
    const { reportId } = req.params;
    const report = await Report.findById(reportId).populate("broadcastHistory.publishedBy", "firstName lastName");

    if (!report) {
      return res.status(statusCodes.NOT_FOUND).json({
        success: false,
        msg: "Report not found",
      });
    }

    res.status(statusCodes.OK).json({
      success: true,
      data: {
        history: report.broadcastHistory,
      },
    });
  } catch (error) {
    console.error("Error fetching broadcast history:", error);
    res.status(statusCodes.INTERNAL_SERVER_ERROR).json({
      success: false,
      msg: "Error retrieving broadcast history",
      error: error.message,
    });
  }
});

// In broadcastController.js

exports.testAdminNotification = asyncHandler(async (req, res) => {
  try {
    const notification = {
      app_id: process.env.ONESIGNAL_APP_ID,
      included_segments: ["All"], // Send to all subscribed users
      contents: {
        en: "Test notification for city admins only",
      },
      headings: {
        en: "Admin Test Alert",
      },
      priority: 10,
    };

    const response = await axios.post("https://onesignal.com/api/v1/notifications", notification, {
      headers: {
        Authorization: `Basic ${process.env.ONESIGNAL_API_KEY}`,
        "Content-Type": "application/json",
      },
    });

    res.status(statusCodes.OK).json({
      success: true,
      notification: response.data,
    });
  } catch (error) {
    console.error("Notification error:", error.response?.data || error);
    res.status(statusCodes.INTERNAL_SERVER_ERROR).json({
      success: false,
      error: error.response?.data || error.message,
    });
  }
});

// Add after testAdminNotification
exports.testMessengerBroadcast = asyncHandler(async (req, res) => {
  try {
    // Messenger broadcast endpoint
    const url = `https://graph.facebook.com/v21.0/${process.env.FACEBOOK_PAGE_ID}/messages`;

    const messageData = {
      message: {
        text: "🚨 Test Alert: This is a test broadcast message from AgapayAlert system.",
      },
      messaging_type: "MESSAGE_TAG",
      tag: "CONFIRMED_EVENT_UPDATE",
      access_token: process.env.FACEBOOK_PAGE_ACCESS_TOKEN,
    };

    const response = await axios.post(url, messageData, {
      headers: {
        "Content-Type": "application/json",
      },
    });

    res.status(statusCodes.OK).json({
      success: true,
      data: response.data,
      msg: "Test message broadcast sent successfully",
    });
  } catch (error) {
    console.error("Messenger broadcast error:", error.response?.data || error);
    res.status(statusCodes.INTERNAL_SERVER_ERROR).json({
      success: false,
      error: error.response?.data?.error?.message || error.message,
      msg: "Failed to send test broadcast",
    });
  }
});
