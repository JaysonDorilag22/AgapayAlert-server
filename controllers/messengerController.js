const axios = require("axios");
const User = require("../models/userModel");
const Report = require("../models/reportModel");
const PoliceStation = require("../models/policeStationModel");
const MessengerReportSession = require("../models/MessengerReportSessionModel");
const { getCoordinatesFromAddress } = require("../utils/geocoding");
const uploadToCloudinary = require("../utils/uploadToCloudinary");
const fs = require('fs');
const path = require('path');
const FB_API_VERSION = 'v22.0';
const FB_API_BASE = `https://graph.facebook.com/${FB_API_VERSION}`;

//find police station
const findPoliceStation = async (selectedId, coordinates) => {
  if (selectedId) {
    const selected = await PoliceStation.findById(selectedId);
    if (selected) return selected;
  }

  // Find nearest within 5km
  const nearest = await PoliceStation.findOne({
    location: {
      $near: {
        $geometry: {
          type: "Point",
          coordinates,
        },
        $maxDistance: 5000,
      },
    },
  });

  // If no station within 5km, find absolute nearest
  if (!nearest) {
    return await PoliceStation.findOne({
      location: {
        $near: {
          $geometry: {
            type: "Point",
            coordinates,
          },
        },
      },
    });
  }

  return nearest;
};

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
      // Existing GET_STARTED logic...
      await sendResponse(sender_psid, {
        text: `Thank you for connecting with AgapayAlert! 🚨\n\nYour PSID is: ${sender_psid}\n\nSave this PSID to link your account in the AgapayAlert app.`
      });

      // Store PSID
      await User.findOneAndUpdate(
        { messengerPSID: sender_psid },
        { messengerPSID: sender_psid },
        { upsert: true, new: true }
      );

      // Add Create Report option to the menu
      await sendResponse(sender_psid, {
        attachment: {
          type: "template",
          payload: {
            template_type: "generic",
            elements: [{
              title: "AgapayAlert Services",
              subtitle: "Get real-time alerts and report missing persons",
              image_url: "https://agapayalert-web.onrender.com/assets/AGAPAYALERT%20-%20imagotype-CfBGhIL1.svg",
              buttons: [
                {
                  type: "postback",
                  title: "Create Report",
                  payload: "CREATE_REPORT"
                },
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
      // Existing ABOUT_US logic...
    } else if (postback.payload === "CREATE_REPORT") {
      await startReportFlow(sender_psid);
    } else if (postback.payload.startsWith("REPORT_TYPE_")) {
      const reportType = postback.payload.replace("REPORT_TYPE_", "");
      await handleReportTypeSelection(sender_psid, reportType);
    } else if (postback.payload === "REPORT_MORE_TYPES") {
      await sendMoreReportTypes(sender_psid);
    } else if (postback.payload === "SUBMIT_REPORT") {
      await submitReport(sender_psid);
    } else if (postback.payload === "CANCEL_REPORT") {
      await cancelReport(sender_psid);
    }
  } catch (error) {
    console.error('❌ Error handling postback:', error);
  }
};

// Update handleMessage function to process report inputs
exports.handleMessage = async (sender_psid, received_message) => {
  try {
    console.log('📨 New message from:', sender_psid);
    
    // Check if user is in a report flow
    const session = await MessengerReportSession.findOne({ psid: sender_psid });
    
    if (session) {
      // Process based on current step
      switch(session.currentStep) {
        case 'PERSON_NAME':
          return await handlePersonNameInput(sender_psid, received_message.text, session);
        case 'PERSON_AGE':
          return await handlePersonAgeInput(sender_psid, received_message.text, session);
        case 'LOCATION':
          return await handleLocationInput(sender_psid, received_message.text, session);
        case 'PHOTO':
          return await handlePhotoInput(sender_psid, received_message, session);
        default:
          // Welcome message for other steps
          await sendReportMenu(sender_psid);
          return;
      }
    }

    // Default response for non-report flow
    await sendResponse(sender_psid, {
      attachment: {
        type: "template",
        payload: {
          template_type: "button",
          text: "Hello! What would you like to do today?",
          buttons: [
            {
              type: "postback",
              title: "Create a Report",
              payload: "CREATE_REPORT"
            },
            {
              type: "postback",
              title: "About AgapayAlert",
              payload: "ABOUT_US"
            }
          ]
        }
      }
    });
  } catch (error) {
    console.error('❌ Error handling message:', error);
  }
};

// Report flow functions
async function startReportFlow(psid) {
  try {
    // Check if user is linked to an account
    const user = await User.findOne({ messengerPSID: psid });
    if (!user) {
      return await sendResponse(psid, { 
        text: "You need to link your Messenger account to an AgapayAlert account first. Please register in the app and link your account using your PSID." 
      });
    }
    
    // Create or reset session
    await MessengerReportSession.findOneAndUpdate(
      { psid },
      { 
        psid,
        currentStep: 'TYPE',
        data: {}
      },
      { upsert: true, new: true }
    );
    
    // Send report type options
    await sendResponse(psid, {
      attachment: {
        type: "template",
        payload: {
          template_type: "button",
          text: "What type of report would you like to submit?",
          buttons: [
            {
              type: "postback",
              title: "Missing Person",
              payload: "REPORT_TYPE_Missing"
            },
            {
              type: "postback",
              title: "Absent Person",
              payload: "REPORT_TYPE_Absent"
            },
            {
              type: "postback",
              title: "More Options",
              payload: "REPORT_MORE_TYPES"
            }
          ]
        }
      }
    });
  } catch (error) {
    console.error('Error starting report flow:', error);
    await sendResponse(psid, { text: "Sorry, we encountered an error. Please try again later." });
  }
}

async function sendMoreReportTypes(psid) {
  await sendResponse(psid, {
    attachment: {
      type: "template",
      payload: {
        template_type: "button",
        text: "Additional report types:",
        buttons: [
          {
            type: "postback",
            title: "Abducted Person",
            payload: "REPORT_TYPE_Abducted"
          },
          {
            type: "postback",
            title: "Kidnapped Person",
            payload: "REPORT_TYPE_Kidnapped"
          },
          {
            type: "postback",
            title: "Hit-and-Run",
            payload: "REPORT_TYPE_Hit-and-Run"
          }
        ]
      }
    }
  });
}

async function handleReportTypeSelection(psid, reportType) {
  // Update session with report type
  await MessengerReportSession.findOneAndUpdate(
    { psid },
    { 
      'data.type': reportType,
      currentStep: 'PERSON_NAME'
    },
    { new: true }
  );
  
  // Ask for person's name
  await sendResponse(psid, { 
    text: "Please enter the person's full name (First and Last name):" 
  });
}

async function handlePersonNameInput(psid, text, session) {
  // Simple name parsing
  const nameParts = text.trim().split(' ');
  let firstName = nameParts[0];
  let lastName = nameParts.length > 1 ? nameParts.slice(1).join(' ') : '';
  
  if (!firstName || !lastName) {
    return await sendResponse(psid, { 
      text: "Please provide both first and last name (e.g., Juan Dela Cruz):" 
    });
  }
  
  // Update session
  await MessengerReportSession.findOneAndUpdate(
    { psid },
    { 
      'data.personInvolved.firstName': firstName,
      'data.personInvolved.lastName': lastName,
      currentStep: 'PERSON_AGE'
    },
    { new: true }
  );
  
  // Ask for person's age
  await sendResponse(psid, { 
    text: "Please enter the person's age:" 
  });
}

async function handlePersonAgeInput(psid, text, session) {
  const age = parseInt(text.trim());
  
  if (isNaN(age) || age < 0 || age > 120) {
    return await sendResponse(psid, { 
      text: "Please enter a valid age (0-120):" 
    });
  }
  
  // Update session
  await MessengerReportSession.findOneAndUpdate(
    { psid },
    { 
      'data.personInvolved.age': age,
      currentStep: 'LOCATION'
    },
    { new: true }
  );
  
  // Ask for location
  await sendResponse(psid, { 
    text: "Please provide the last known location (include street, barangay, city and zip code if possible):" 
  });
}

async function handleLocationInput(psid, text, session) {
  const address = text.trim();
  
  if (address.length < 10) {
    return await sendResponse(psid, { 
      text: "Please provide more details about the location:" 
    });
  }
  
  // Simple address parsing - in production you would need a more sophisticated parser
  let streetAddress = address;
  let barangay = "Unknown";
  let city = "Unknown";
  let zipCode = "Unknown";
  
  // Try to extract city from the address
  const cityMatch = address.match(/(?:in|at|,)\s+([A-Za-z\s]+City|[A-Za-z\s]+Municipality)/i);
  if (cityMatch) {
    city = cityMatch[1].trim();
  }
  
  // Update session
  await MessengerReportSession.findOneAndUpdate(
    { psid },
    { 
      'data.location.address.streetAddress': streetAddress,
      'data.location.address.barangay': barangay,
      'data.location.address.city': city,
      'data.location.address.zipCode': zipCode,
      currentStep: 'PHOTO'
    },
    { new: true }
  );
  
  // Ask for photo
  await sendResponse(psid, { 
    text: "Please upload a recent photo of the person:" 
  });
}

async function handlePhotoInput(psid, message, session) {
  try {
    // Check if message contains an image attachment
    if (message.attachments && message.attachments[0] && message.attachments[0].type === 'image') {
      const photoUrl = message.attachments[0].payload.url;
      
      // Process photo right away to avoid issues later
      const photoResult = await processMessengerPhoto(photoUrl, psid);
      
      if (!photoResult) {
        return await sendResponse(psid, { 
          text: "We had trouble processing your photo. Please try uploading it again." 
        });
      }
      
      // Update session with processed image info
      await MessengerReportSession.findOneAndUpdate(
        { psid },
        { 
          'data.photo': {
            url: photoResult.url,
            public_id: photoResult.public_id
          },
          currentStep: 'CONFIRM'
        },
        { new: true }
      );
      
      // Get updated session
      const updatedSession = await MessengerReportSession.findOne({ psid });
      const reportData = updatedSession.data;
      
      // Show confirmation with image preview
      await sendResponse(psid, {
        attachment: {
          type: "template",
          payload: {
            template_type: "generic",
            elements: [{
              title: "Report Preview",
              subtitle: `Type: ${reportData.type}\nName: ${reportData.personInvolved.firstName} ${reportData.personInvolved.lastName}`,
              image_url: photoResult.url,
              buttons: [
                {
                  type: "postback",
                  title: "Submit Report",
                  payload: "SUBMIT_REPORT"
                },
                {
                  type: "postback",
                  title: "Cancel",
                  payload: "CANCEL_REPORT"
                }
              ]
            }]
          }
        }
      });
    } else {
      await sendResponse(psid, { 
        text: "Please upload a photo of the person (tap the + button and select Gallery):" 
      });
    }
  } catch (error) {
    console.error('Error processing photo:', error);
    await sendResponse(psid, { 
      text: "We encountered an error while processing your photo. Please try again." 
    });
  }
}

/**
 * Process and upload photo from Messenger to Cloudinary
 * @param {string} photoUrl - URL of the photo from Messenger
 * @param {string} psid - Sender's PSID for naming the temp file
 * @returns {Promise<Object|null>} - Cloudinary upload result or null if failed
 */
async function processMessengerPhoto(photoUrl, psid) {
  try {
    // Download image from Facebook
    const response = await axios.get(photoUrl, { 
      responseType: 'arraybuffer',
      timeout: 10000 // 10 second timeout
    });
    
    const buffer = Buffer.from(response.data, 'binary');
    
    // Validate image size (10MB max)
    if (buffer.length > 10 * 1024 * 1024) {
      console.error('Image too large:', buffer.length / (1024 * 1024), 'MB');
      return null;
    }
    
    // Create temp directory if it doesn't exist
    const tempDir = path.join(__dirname, '../uploads');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
    
    const tempFilePath = path.join(tempDir, `messenger_${psid}_${Date.now()}.jpg`);
    fs.writeFileSync(tempFilePath, buffer);
    
    // Upload to Cloudinary with optimization options
    const photoResult = await uploadToCloudinary(tempFilePath, "messenger_reports", 'image');
    
    // Check if file exists before attempting to delete
    // if (fs.existsSync(tempFilePath)) {
    //   try {
    //     fs.unlinkSync(tempFilePath);
    //     console.log(`Successfully deleted temporary file: ${tempFilePath}`);
    //   } catch (unlinkError) {
    //     console.warn(`Warning: Could not delete temporary file ${tempFilePath}:`, unlinkError);
    //   }
    // }
    
    return photoResult;
  } catch (error) {
    console.error('Error processing messenger photo:', error);
    return null;
  }
}

async function submitReport(psid) {
  try {
    // Find session
    const session = await MessengerReportSession.findOne({ psid });
    if (!session) {
      return await sendResponse(psid, { text: "Your report session has expired. Please start again." });
    }
    
    // Find user
    const user = await User.findOne({ messengerPSID: psid });
    if (!user) {
      return await sendResponse(psid, { 
        text: "Your Facebook account needs to be linked to an AgapayAlert account to submit reports." 
      });
    }
    
    // Get session data
    const reportData = session.data;
    
    // Check if we have photo data
    if (!reportData.photo || !reportData.photo.url) {
      return await sendResponse(psid, { 
        text: "Missing photo information. Please restart the report process and upload a photo." 
      });
    }
    
    // Get coordinates
    const location = {
      address: {
        streetAddress: reportData.location.address.streetAddress || "Unknown",
        barangay: reportData.location.address.barangay || "Unknown",
        city: reportData.location.address.city || "Unknown",
        zipCode: reportData.location.address.zipCode || "Unknown"
      }
    };
    
    const geoData = await getCoordinatesFromAddress(location.address);
    if (!geoData.success) {
      await sendResponse(psid, { 
        text: "We couldn't process the location precisely. Please provide more details in the app later."
      });
      // Continue with approximate coordinates
    }
    
    // Find police station
    const coordinates = geoData.success ? geoData.coordinates : [0, 0];
    const assignedStation = await findPoliceStation(null, coordinates);
    if (!assignedStation) {
      return await sendResponse(psid, { 
        text: "We couldn't find a police station to assign. Please submit your report through the app."
      });
    }
    
    // Create report
    const report = new Report({
      reporter: user._id,
      type: reportData.type,
      personInvolved: {
        firstName: reportData.personInvolved.firstName,
        lastName: reportData.personInvolved.lastName,
        age: reportData.personInvolved.age,
        // Required fields with default values
        dateOfBirth: new Date(Date.now() - (reportData.personInvolved.age * 365 * 24 * 60 * 60 * 1000)), // Approximate from age
        lastSeenDate: new Date(),
        lastSeentime: new Date().toTimeString().substring(0, 5),
        lastKnownLocation: reportData.location.address.streetAddress,
        relationship: "Not specified via messenger",
        mostRecentPhoto: {
          url: reportData.photo.url,
          public_id: reportData.photo.public_id,
        }
      },
      location: {
        type: "Point",
        coordinates: coordinates,
        address: location.address
      },
      assignedPoliceStation: assignedStation._id,
      broadcastConsent: true,
      consentUpdateHistory: [
        {
          previousValue: false,
          newValue: true,
          updatedBy: user._id,
          date: new Date(),
        }
      ]
    });
    
    await report.save();
    
    // Delete session
    await session.deleteOne();
    
    // Confirm to user
    await sendResponse(psid, { 
      text: `Thank you. Your report has been submitted successfully!\n\nCase ID: ${report.caseId}\n\nIt has been assigned to ${assignedStation.name}.\n\nYou can view and update this report in the AgapayAlert app.` 
    });
    
  } catch (error) {
    console.error('Error submitting report:', error);
    await sendResponse(psid, { 
      text: "We encountered an error while submitting your report. Please try again or use the AgapayAlert app."
    });
  }
}

async function cancelReport(psid) {
  // Delete the session
  await MessengerReportSession.deleteOne({ psid });
  
  // Confirm cancellation
  await sendResponse(psid, { 
    text: "Your report has been cancelled. How else can I help you?"
  });
  
  // Send report menu again
  await sendReportMenu(psid);
}

async function sendReportMenu(psid) {
  await sendResponse(psid, {
    attachment: {
      type: "template",
      payload: {
        template_type: "button",
        text: "What would you like to do?",
        buttons: [
          {
            type: "postback",
            title: "Create Report",
            payload: "CREATE_REPORT"
          },
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
      }
    }
  });
}

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