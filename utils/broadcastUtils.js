const axios = require("axios");
const { sendEmailNotification } = require("./notificationUtils");
const dotenv = require("dotenv");
const { broadcastTemplates } = require("./contentTemplates");
dotenv.config();

const ONESIGNAL_API_URL = "https://onesignal.com/api/v1/notifications";
const FACEBOOK_GRAPH_API_URL = "https://graph.facebook.com/v22.0";

/**
 * Send a push notification.
 * @param {string} message - The notification message.
 * @param {Array<string>} recipients - The OneSignal player IDs of the recipients.
 */
const sendPushNotification = async (message, recipients) => {
  const notification = {
    app_id: process.env.ONESIGNAL_APP_ID,
    include_player_ids: recipients,
    contents: { en: message },
  };

  try {
    const response = await axios.post(ONESIGNAL_API_URL, notification, {
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${process.env.ONESIGNAL_API_KEY}`,
      },
    });
    return response.data;
  } catch (error) {
    console.error(
      "Error sending push notification:",
      error.response ? error.response.data : error.message
    );
    throw new Error("Failed to send push notification");
  }
};

/**
 * Create a Facebook post.
 * @param {Object} report - The report object.
 */
const createFacebookPost = async (report) => {
  const url = `${FACEBOOK_GRAPH_API_URL}/${process.env.FACEBOOK_PAGE_ID}/photos`;
  const content = broadcastTemplates.facebook(report);
  
  try {
    const response = await axios.post(url, {
      caption: content.message,
      url: content.image,
      access_token: process.env.FACEBOOK_PAGE_ACCESS_TOKEN,
    });

    return {
      success: true,
      postId: response.data.id,
      data: response.data,
    };
  } catch (error) {
    console.error("Facebook API Error:", error.response?.data || error);
    return {
      success: false,
      error: error.message
    };
  }
};

/**
 * Delete a Facebook post.
 * @param {string} postId - The ID of the post to delete.
 */
const deleteFacebookPost = async (postId) => {
  const url = `${FACEBOOK_GRAPH_API_URL}/${postId}`;

  try {
    await axios.delete(url, {
      params: {
        access_token: process.env.FACEBOOK_PAGE_ACCESS_TOKEN,
      },
    });

    return {
      success: true,
      msg: "Facebook post deleted successfully",
    };
  } catch (error) {
    console.error(
      "Error deleting Facebook post:",
      error.response?.data || error
    );
    throw new Error("Failed to delete Facebook post");
  }
};

module.exports = {
  sendPushNotification,
  createFacebookPost,
  deleteFacebookPost,
};