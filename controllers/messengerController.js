const axios = require("axios");
const User = require("../models/userModel");
const FB_API_VERSION = 'v22.0';
const FB_API_BASE = `https://graph.facebook.com/${FB_API_VERSION}`;

// Initialize Messenger Profile
exports.initializeMessenger = async () => {
  try {
    console.log('🔄 Initializing Messenger profile...');
    
    // Reset existing settings
    await axios.delete(
      'https://graph.facebook.com/v22.0/me/messenger_profile',
      {
        params: { access_token: process.env.FACEBOOK_PAGE_ACCESS_TOKEN }
      }
    );

    // Set up new profile
    await axios.post(
      'https://graph.facebook.com/v22.0/me/messenger_profile',
      {
        get_started: {
          payload: "GET_STARTED"
        },
        greeting: [{
          locale: "default",
          text: "Welcome to AgapayAlert! Click Get Started to begin."
        }]
      },
      {
        params: { access_token: process.env.FACEBOOK_PAGE_ACCESS_TOKEN }
      }
    );

    console.log('✅ Messenger profile initialized');
    return true;
  } catch (error) {
    console.error('❌ Error initializing messenger:', error);
    return false;
  }
};
// Verify webhook
exports.verifyWebhook = (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  console.log('🔍 Verifying webhook...');
  console.log('Mode:', mode);
  console.log('Token:', token);
  console.log('Challenge:', challenge);

  if (mode === 'subscribe' && token === process.env.MESSENGER_VERIFY_TOKEN) {
    console.log('✅ Webhook verified');
    return res.status(200).send(challenge);
  }
  console.log('❌ Webhook verification failed');
  return res.sendStatus(403);
};


// Helper Functions
async function sendResponse(sender_psid, response) {
  try {
    await axios.post(
      'https://graph.facebook.com/v22.0/me/messages',
      {
        recipient: { id: sender_psid },
        message: response,
        messaging_type: "RESPONSE"
      },
      {
        params: { access_token: process.env.FACEBOOK_PAGE_ACCESS_TOKEN }
      }
    );
    console.log('✅ Message sent successfully to:', sender_psid);
  } catch (error) {
    console.error('❌ Error sending message:', error);
    throw error;
  }
}

// Add greeting message
exports.setGreetingMessage = async () => {
  try {
    await axios.post(
      "https://graph.facebook.com/v22.0/me/messenger_profile",
      {
        greeting: [
          {
            locale: "default",
            text: "Welcome to AgapayAlert! We help locate missing persons through real-time alerts. 🚨",
          },
        ],
      },
      {
        params: { access_token: process.env.FACEBOOK_PAGE_ACCESS_TOKEN },
      }
    );
  } catch (error) {
    console.error("Error setting greeting:", error);
  }
};

// Add Get Started button
exports.setGetStartedButton = async () => {
  try {
    await axios.post(
      "https://graph.facebook.com/v22.0/me/messenger_profile",
      {
        get_started: {
          payload: "GET_STARTED",
        },
      },
      {
        params: { access_token: process.env.FACEBOOK_PAGE_ACCESS_TOKEN },
      }
    );
  } catch (error) {
    console.error("Error setting get started button:", error);
  }
};

exports.handleMessage = async (sender_psid, received_message) => {
  try {
    console.log('📨 New message from PSID:', sender_psid);
    console.log('Message:', received_message);

    // Send immediate PSID response
    await sendResponse(sender_psid, {
      text: `Welcome to AgapayAlert! 👋\n\nYour PSID is: ${sender_psid}\n\nSave this PSID to link your account in the AgapayAlert app.`
    });

    // Store PSID
    await User.findOneAndUpdate(
      { messengerPSID: sender_psid },
      { messengerPSID: sender_psid },
      { upsert: true, new: true }
    );

  } catch (error) {
    console.error('❌ Error handling message:', error);
  }
};
exports.handlePostback = async (sender_psid, postback) => {
  try {
    console.log('🔄 Received postback:', postback);
    
    if (postback.payload === 'GET_STARTED') {
      await sendResponse(sender_psid, {
        text: `Welcome to AgapayAlert! 👋\n\nYour PSID is: ${sender_psid}\n\nSave this PSID to link your account.`
      });
    }
  } catch (error) {
    console.error('❌ Error handling postback:', error);
  }
};

exports.sendCustomMessage = async (psid, message) => {
  return await sendResponse(psid, { text: message });
};

// Handle webhook events
exports.handleWebhook = async (req, res) => {
  console.log('📩 Incoming webhook event');
  
  const body = req.body;

  // Verify this is a real webhook event
  if (!body?.object || body.object !== 'page') {
    console.error('❌ Invalid webhook event');
    return res.sendStatus(404);
  }

  // Process each entry
  for (const entry of body.entry) {
    const webhook_event = entry.messaging?.[0];
    if (!webhook_event) continue;

    const sender_psid = webhook_event.sender?.id;
    console.log('👤 New interaction from PSID:', sender_psid);

    try {
      // Handle first visit/message
      if (webhook_event.message || webhook_event.postback?.payload === 'GET_STARTED') {
        // Send immediate welcome
        await sendResponse(sender_psid, {
          text: `Welcome to AgapayAlert! 👋\n\nYour PSID: ${sender_psid}\n\nPlease copy this PSID to link your account.`
        });

        // Store PSID
        await User.findOneAndUpdate(
          { messengerPSID: sender_psid },
          { messengerPSID: sender_psid },
          { upsert: true, new: true }
        );

        console.log('✅ PSID stored and welcome sent');
      }
    } catch (error) {
      console.error('❌ Error:', error);
    }
  }

  // Always acknowledge webhook
  res.status(200).send('EVENT_RECEIVED');
};

