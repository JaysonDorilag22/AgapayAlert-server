const OneSignal = require('onesignal-node');
const dotenv = require('dotenv');

dotenv.config();

const client = new OneSignal.Client({
  userAuthKey: process.env.ONESIGNAL_API_KEY,
  app: { appAuthKey: process.env.ONESIGNAL_API_KEY, appId: process.env.ONESIGNAL_APP_ID },
  baseUrl: process.env.ONESIGNAL_BASE_URL
});

module.exports = client;