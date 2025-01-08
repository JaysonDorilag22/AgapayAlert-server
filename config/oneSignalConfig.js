const axios = require('axios');
const User = require('../models/userModel');
const dotenv = require('dotenv');

dotenv.config();

// Simple axios client for OneSignal API
const oneSignalClient = axios.create({
  baseURL: process.env.ONESIGNAL_BASE_URL || 'https://onesignal.com/api/v1',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Basic ${process.env.ONESIGNAL_API_KEY}`
  }
});

// Helper to get target users based on criteria
const getTargetUsers = async (options) => {
  try {
    let query = { 'preferredNotifications.push': true };

    // Filter by city if specified
    if (options.city) {
      query['address.city'] = options.city;
    }

    // Filter by police station if specified
    if (options.policeStationId) {
      query.policeStation = options.policeStationId;
    }

    // Filter by roles if specified
    if (options.roles && options.roles.length > 0) {
      query.roles = { $in: options.roles };
    }

    // Filter by specific users if specified
    if (options.userIds && options.userIds.length > 0) {
      query._id = { $in: options.userIds };
    }

    // Get users who have device tokens
    const users = await User.find({
      ...query,
      deviceToken: { $exists: true, $ne: null }
    });

    return users.map(user => user.deviceToken);
  } catch (error) {
    console.error('Error getting target users:', error);
    throw error;
  }
};

const createNotification = async (options) => {
  try {
    const deviceTokens = await getTargetUsers(options);

    if (deviceTokens.length === 0) {
      console.log('No target users found for notification');
      return;
    }

    const notification = {
      app_id: process.env.ONESIGNAL_APP_ID,
      include_player_ids: deviceTokens,
      contents: { en: options.message },
      headings: { en: options.title || 'AgapayAlert Notification' },
      data: options.data || {}
    };

    const response = await oneSignalClient.post('/notifications', notification);
    return response.data;

  } catch (error) {
    console.error('OneSignal API Error:', error.response?.data || error);
    throw error;
  }
};

module.exports = {
  oneSignalClient,
  createNotification
};