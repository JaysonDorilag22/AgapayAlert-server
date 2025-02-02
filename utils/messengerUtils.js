const axios = require('axios');

async function sendMessengerBroadcast(report) {
  try {
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

    const messageData = {
      attachment: {
        type: "template",
        payload: {
          template_type: "generic",
          elements: [{
            title: `${report.type} Alert`,
            subtitle: `Name: ${report.personInvolved.firstName} ${report.personInvolved.lastName}\nAge: ${report.personInvolved.age}\nLast Seen: ${report.lastSeenLocation.address}`,
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
    return { success: false, error: error.message };
  }
}

module.exports = { sendMessengerBroadcast };