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

// Helper to get target users based on scope
const getTargetUsers = async (scope) => {
  try {
    let query = { 
      'preferredNotifications.push': true,
      deviceToken: { $exists: true, $ne: null }
    };

    // Filter by scope
    switch(scope.type) {
      case 'city':
        query['address.city'] = scope.city;
        break;
        
      case 'radius':
        query['address.location'] = {
          $near: {
            $geometry: scope.coordinates,
            $maxDistance: scope.radius * 1000 // Convert km to meters
          }
        };
        break;
      // 'all' case doesn't need additional filters
    }

    const users = await User.find(query);
    return users.map(user => user.deviceToken);
  } catch (error) {
    console.error('Error getting target users:', error);
    throw error;
  }
};

// Create and send notification
const createNotification = async (options) => {
  try {
    const deviceTokens = await getTargetUsers(options.scope);

    if (deviceTokens.length === 0) {
      return { success: false, msg: 'No target users found' };
    }

    const notification = {
      app_id: process.env.ONESIGNAL_APP_ID,
      include_player_ids: deviceTokens,
      contents: { en: options.message },
      headings: { en: options.title || 'AgapayAlert Notification' },
      data: options.data || {}
    };

    const response = await oneSignalClient.post('/notifications', notification);
    return {
      success: true,
      recipients: deviceTokens.length,
      data: response.data
    };

  } catch (error) {
    console.error('OneSignal API Error:', error.response?.data || error);
    return {
      success: false,
      error: error.message
    };
  }
};

module.exports = {
  oneSignalClient,
  createNotification
};