const express = require("express");
const router = express.Router();
const messengerController = require("../controllers/messengerController");
const { protect } = require('../middlewares/authMiddleware');
const messengerAuthController = require('../controllers/messengerAuthController');

router.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === process.env.MESSENGER_VERIFY_TOKEN) {
    console.log('✅ Webhook verified');
    res.status(200).send(challenge);
  } else {
    console.error('❌ Webhook verification failed');
    res.sendStatus(403);
  }
});

// Handle incoming messages
router.post('/webhook', async (req, res) => {
  console.log('📩 Received webhook event:', req.body);

  const body = req.body;

  if (body.object === 'page') {
    for (const entry of body.entry) {
      // Log entire entry for debugging
      console.log('Entry:', entry);

      const webhook_event = entry.messaging?.[0];
      if (!webhook_event) {
        console.log('⚠️ No messaging event found');
        continue;
      }

      const sender_psid = webhook_event.sender?.id;
      console.log('👤 Sender PSID:', sender_psid);

      try {
        if (webhook_event.message) {
          await messengerController.handleMessage(sender_psid, webhook_event.message);
        } else if (webhook_event.postback) {
          await messengerController.handlePostback(sender_psid, webhook_event.postback);
        }
      } catch (error) {
        console.error('❌ Error processing webhook:', error);
      }
    }
    res.status(200).send('EVENT_RECEIVED');
  } else {
    console.log('❌ Invalid webhook object:', body.object);
    res.sendStatus(404);
  }
});
// Send custom message
router.post("/send-message", async (req, res) => {
  const { psid, message } = req.body;

  try {
    await messengerController.sendCustomMessage(psid, message);
    res.status(200).json({
      success: true,
      message: "Message delivered successfully",
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});


router.post('/link', protect, messengerAuthController.linkMessengerAccount);
router.post('/unlink', protect, messengerAuthController.unlinkMessengerAccount);
router.get('/status', protect, messengerAuthController.getMessengerStatus);

module.exports = router;
