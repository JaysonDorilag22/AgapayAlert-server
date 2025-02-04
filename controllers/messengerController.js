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

    // Send welcome message with buttons
    await sendResponse(sender_psid, {
      attachment: {
        type: "template",
        payload: {
          template_type: "button",
          text: "Welcome to AgapayAlert! 👋\nClick the button below to get started:",
          buttons: [
            {
              type: "postback",
              title: "Get Started",
              payload: "GET_STARTED"
            }
          ]
        }
      }
    });

  } catch (error) {
    console.error('❌ Error handling message:', error);
  }
};

exports.handlePostback = async (sender_psid, postback) => {
  try {
    console.log('🔄 Processing postback:', postback.payload);

    if (postback.payload === 'GET_STARTED') {
      // Send PSID message
      await sendResponse(sender_psid, {
        text: `Thank you for connecting with AgapayAlert! 🚨\n\nYour PSID is: ${sender_psid}\n\nSave this PSID to link your account in the AgapayAlert app.`
      });

      // Store PSID
      await User.findOneAndUpdate(
        { messengerPSID: sender_psid },
        { messengerPSID: sender_psid },
        { upsert: true, new: true }
      );

      // Send menu options
      await sendResponse(sender_psid, {
        attachment: {
          type: "template",
          payload: {
            template_type: "generic",
            elements: [{
              title: "AgapayAlert Services",
              subtitle: "Get real-time alerts about missing persons in your area",
              image_url: "https://agapayalert-web.onrender.com/assets/AGAPAYALERT%20-%20imagotype-CfBGhIL1.svg",
              buttons: [
                {
                  type: "postback",
                  title: "About Us",
                  payload: "ABOUT_US"
                },
                {
                  type: "web_url",
                  url: "https://agapayalert-web.onrender.com/",
                  title: "Visit Website"
                }
              ]
            }]
          }
        }
      });
    } else if (postback.payload === "ABOUT_US") {
      await sendResponse(sender_psid, {
        text: "AgapayAlert is a community-driven platform helping locate missing persons through real-time alerts and coordination with local authorities. 🚨\n\nWe work together to make our communities safer."
      });
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