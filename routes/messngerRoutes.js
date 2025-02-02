const express = require('express');
const router = express.Router();

router.get('/webhook', (req, res) => {
  // Parse hub parameters and decode token
  const mode = req.query['hub.mode'];
  const token = decodeURIComponent(req.query['hub.verify_token'] + 
                (req.query['^sbfdnsbfndsfuuheqwhekjqwewqe'] ? 
                '^sbfdnsbfndsfuuheqwhekjqwewqe' : ''));
  const challenge = req.query['hub.challenge'];

  console.log('Webhook Request:', {
    query: req.query,
    mode,
    token: token?.slice(0,5) + '...',
    storedToken: process.env.MESSENGER_VERIFY_TOKEN?.slice(0,5) + '...',
    tokensMatch: token === process.env.MESSENGER_VERIFY_TOKEN,
    challenge
  });

  // Verify parameters with decoded token
  if (mode && token && challenge) {
    if (mode === 'subscribe' && token === process.env.MESSENGER_VERIFY_TOKEN) {
      console.log('✅ Webhook verified');
      return res.status(200).send(challenge);
    }
  }

  console.error('❌ Verification failed');
  return res.sendStatus(403);
});


// Handle incoming webhook events
router.post('/webhook', (req, res) => {
  const body = req.body;
  console.log('Received webhook event:', body);

  if (body.object === 'page') {
    return res.status(200).send('EVENT_RECEIVED');
  }
  return res.sendStatus(404);
});

module.exports = router;