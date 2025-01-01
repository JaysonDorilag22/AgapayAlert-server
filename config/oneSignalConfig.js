const axios = require('axios');
const dotenv = require('dotenv');

dotenv.config();

if (!process.env.ONESIGNAL_APP_ID || !process.env.ONESIGNAL_API_KEY) {
  throw new Error('OneSignal configuration is missing required environment variables');
}

const client = axios.create({
  baseURL: 'https://onesignal.com/api/v1',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${process.env.ONESIGNAL_API_KEY}`
  }
});

// Helper method for creating notifications
client.createNotification = async (notification) => {
  try {
    const response = await client.post('/notifications', {
      app_id: process.env.ONESIGNAL_APP_ID,
      ...notification
    });
    return response.data;
  } catch (error) {
    console.error('OneSignal API Error:', error.response?.data || error.message);
    throw error;
  }
};

module.exports = client;