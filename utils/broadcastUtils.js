const axios = require('axios');
const { sendEmailNotification } = require('./notificationUtils');
const dotenv = require('dotenv');
const { broadcastTemplates } = require('./contentTemplates');
dotenv.config();

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
    const response = await axios.post('https://onesignal.com/api/v1/notifications', notification, {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Basic ${process.env.ONESIGNAL_API_KEY}`,
      },
    });
    console.log('OneSignal response:', response.data);
  } catch (error) {
    console.error('Error sending push notification:', error.response ? error.response.data : error.message);
    throw new Error('Failed to send push notification');
  }
};

/**
 * Create a Facebook post.
 * @param {Object} report - The report object.
 */
// Create Facebook post
const createFacebookPost = async (report) => {
  try {
    const content = broadcastTemplates.facebook(report);
    
    // Use newer Graph API endpoint for photos
    const url = `https://graph.facebook.com/v22.0/${process.env.FACEBOOK_PAGE_ID}/photos`;
    
    const formData = {
      caption: content.message,
      url: content.image,
      access_token: process.env.FACEBOOK_PAGE_ACCESS_TOKEN
    };

    const response = await axios.post(url, formData, {
      headers: {
        'Content-Type': 'application/json'
      }
    });

    return {
      success: true,
      postId: response.data.id,
      data: response.data
    };

  } catch (error) {
    console.error('Facebook API Error:', {
      message: error.response?.data?.error?.message,
      code: error.response?.data?.error?.code,
      type: error.response?.data?.error?.type
    });
    return {
      success: false,
      error: error.response?.data?.error?.message || error.message
    };
  }
};

// Remove duplicate sendPushNotification

// Delete Facebook post
const deleteFacebookPost = async (postId) => {
  const url = `https://graph.facebook.com/${postId}`;
  
  try {
    await axios.delete(url, {
      params: {
        access_token: process.env.FACEBOOK_PAGE_ACCESS_TOKEN
      }
    });
    
    return {
      success: true,
      msg: 'Facebook post deleted successfully'
    };
  } catch (error) {
    console.error('Error deleting Facebook post:', error.response?.data || error);
    throw new Error('Failed to delete Facebook post');
  }
};


module.exports = {
  sendPushNotification,
  createFacebookPost,
  deleteFacebookPost
};