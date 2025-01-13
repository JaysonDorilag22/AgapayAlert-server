const axios = require('axios');
const { sendEmailNotification } = require('./notificationUtils');
const dotenv = require('dotenv');

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
  const message = `New report: ${report.details.subject}\nDescription: ${report.details.description}`;
  const url = `https://graph.facebook.com/${process.env.FACEBOOK_PAGE_ID}/feed`;

  try {
    const response = await axios.post(url, {
      message,
      access_token: process.env.FACEBOOK_PAGE_ACCESS_TOKEN,
      link: report.personInvolved.mostRecentPhoto.url,
    });
    
    // Return the post ID for future reference
    return {
      success: true,
      postId: response.data.id,
      data: response.data
    };
  } catch (error) {
    console.error('Error creating Facebook post:', error.response?.data || error);
    throw new Error('Failed to create Facebook post');
  }
};

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