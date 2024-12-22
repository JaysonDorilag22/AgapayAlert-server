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
const createFacebookPost = async (report) => {
  const message = `New report: ${report.details.subject}\nDescription: ${report.details.description}`;
  const url = `https://graph.facebook.com/${process.env.FACEBOOK_PAGE_ID}/feed`;

  try {
    const response = await axios.post(url, {
      message,
      access_token: process.env.FACEBOOK_PAGE_ACCESS_TOKEN,
      link: report.personInvolved.mostRecentPhoto.url,
    });
    console.log('Facebook post response:', response.data);
  } catch (error) {
    console.error('Error creating Facebook post:', error.response ? error.response.data : error.message);
    throw new Error('Failed to create Facebook post');
  }
};

module.exports = {
  sendPushNotification,
  createFacebookPost,
};