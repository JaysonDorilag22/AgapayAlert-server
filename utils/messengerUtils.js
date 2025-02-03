const axios = require('axios');

async function sendMessengerBroadcast(report) {
  try {
    // Format last seen time to AM/PM
    const lastSeenDate = new Date(report.personInvolved.lastSeenDate);
    const lastSeenTime = lastSeenDate.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    });

    // Get subscribers
    const subscribersResponse = await axios.get(
      `https://graph.facebook.com/v22.0/${process.env.FACEBOOK_PAGE_ID}/conversations`,
      {
        params: {
          access_token: process.env.FACEBOOK_PAGE_ACCESS_TOKEN,
          fields: "participants"
        }
      }
    );

    const subscribers = subscribersResponse.data.data.map(conv => 
      conv.participants.data[0].id
    );

    if (subscribers.length === 0) {
      return { success: false, msg: 'No subscribers found' };
    }

    // Format location address
    const locationAddress = report.location?.address 
      ? `${report.location.address.streetAddress || ''}, ${report.location.address.barangay || ''}, ${report.location.address.city || ''}`
      : 'Location not specified';

    // Prepare message data
    const messageData = {
      attachment: {
        type: "template",
        payload: {
          template_type: "generic",
          elements: [{
            title: `${report.type} Alert`,
            subtitle: `Name: ${report.personInvolved.firstName} ${report.personInvolved.lastName}\nAge: ${report.personInvolved.age}\nLast Seen: ${locationAddress}\nTime: ${lastSeenTime}`,
            image_url: report.personInvolved.mostRecentPhoto.url,
            buttons: [{
              type: "web_url",
              url: `https://agapayalert.vercel.app/reports/${report._id}`,
              title: "View Details"
            }]
          }]
        }
      }
    };

    // Send to all subscribers
    await Promise.all(subscribers.map(psid => 
      axios.post(
        `https://graph.facebook.com/v22.0/me/messages`,
        {
          recipient: { id: psid },
          message: messageData,
          messaging_type: "MESSAGE_TAG",
          tag: "CONFIRMED_EVENT_UPDATE"
        },
        {
          params: { access_token: process.env.FACEBOOK_PAGE_ACCESS_TOKEN }
        }
      )
    ));

    return {
      success: true,
      count: subscribers.length,
      msg: `Alert sent to ${subscribers.length} messenger subscribers`
    };

  } catch (error) {
    console.error('Messenger broadcast error:', error);
    return { 
      success: false, 
      error: error.message,
      count: 0 
    };
  }
}

module.exports = { sendMessengerBroadcast };