const axios = require("axios");
const User = require("../models/userModel");
const FB_API_VERSION = 'v22.0';
const FB_API_BASE = `https://graph.facebook.com/${FB_API_VERSION}`;

exports.initializeMessenger = async () => {
  try {
    console.log('🔄 Initializing Messenger profile...');
    
    // Set up messenger profile
    await axios.post(
      `${FB_API_BASE}/me/messenger_profile`,
      {
        get_started: {
          payload: "GET_STARTED"
        },
        greeting: [{
          locale: "default",
          text: "Welcome to AgapayAlert! Click Get Started to begin."
        }],
        persistent_menu: [{
          locale: "default",
          composer_input_disabled: false,
          call_to_actions: [
            {
              type: "postback",
              title: "Get Started",
              payload: "GET_STARTED"
            },
            {
              type: "web_url",
              title: "Visit Website",
              url: "https://jsond.onrender.com/"
            }
          ]
        }]
      },
      {
        headers: { 'Content-Type': 'application/json' },
        params: { access_token: process.env.FACEBOOK_PAGE_ACCESS_TOKEN }
      }
    );

    console.log('✅ Messenger profile initialized');
    return true;
  } catch (error) {
    console.error('❌ Error initializing messenger:', error.response?.data || error);
    return false;
  }
};

exports.handleMessage = async (sender_psid, received_message) => {
  try {
    console.log('📨 New message from:', sender_psid);

    // Send welcome with PSID
    await sendResponse(sender_psid, {
      text: `Welcome to AgapayAlert! 👋\n\nYour PSID is: ${sender_psid}\n\nSave this PSID to link your account.`
    });

    // Store PSID
    await User.findOneAndUpdate(
      { messengerPSID: sender_psid },
      { messengerPSID: sender_psid },
      { upsert: true, new: true }
    );

    console.log('✅ PSID stored for:', sender_psid);

  } catch (error) {
    console.error('❌ Error handling message:', error);
  }
};

exports.handlePostback = async (sender_psid, postback) => {
  try {
    console.log('🔄 Postback from:', sender_psid);

    if (postback.payload === 'GET_STARTED') {
      await sendResponse(sender_psid, {
        text: `Welcome to AgapayAlert! 👋\n\nYour PSID is: ${sender_psid}\n\nSave this PSID to link your account.`
      });

      // Store PSID on Get Started
      await User.findOneAndUpdate(
        { messengerPSID: sender_psid },
        { messengerPSID: sender_psid },
        { upsert: true, new: true }
      );
    }
  } catch (error) {
    console.error('❌ Error handling postback:', error);
  }
};

async function sendResponse(sender_psid, response) {
  try {
    await axios.post(
      `${FB_API_BASE}/me/messages`,
      {
        recipient: { id: sender_psid },
        message: response,
        messaging_type: "RESPONSE"
      },
      {
        headers: { 'Content-Type': 'application/json' },
        params: { access_token: process.env.FACEBOOK_PAGE_ACCESS_TOKEN }
      }
    );
    console.log('✅ Message sent to:', sender_psid);
  } catch (error) {
    console.error('❌ Error sending message:', error.response?.data || error);
    throw error;
  }
}

exports.sendCustomMessage = async (psid, message) => {
  return await sendResponse(psid, { text: message });
};