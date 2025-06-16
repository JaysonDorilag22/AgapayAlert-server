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

// Modified findPoliceStation function to respect user selection
const findPoliceStation = async (selectedId, coordinates, useAutoAssign = false) => {
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

exports.handlePostback = async (sender_psid, postback) => {
  try {
    console.log('🔄 Processing postback:', postback.payload);

    if (postback.payload === 'GET_STARTED') {
      // Existing GET_STARTED logic...
      await sendResponse(sender_psid, {
        text: `Thank you for connecting with AgapayAlert! 🚨\n\nYour PSID is: ${sender_psid}\n\nSave this PSID to link your account in the AgapayAlert app.`
      });

      // Store PSID for later linking
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
      // About us logic goes here
      await sendResponse(sender_psid, {
        text: "AgapayAlert is an emergency response platform connecting citizens with local authorities for quick assistance during emergencies and missing person cases."
      });
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
        case 'DESCRIPTION':
          return await handleDescriptionInput(sender_psid, received_message.text, session);
        case 'LOCATION':
          return await handleLocationInput(sender_psid, received_message.text, session);
        case 'PHOTO':
          return await handlePhotoInput(sender_psid, received_message, session);
        case 'CREDENTIAL':
          return await handleCredentialInput(sender_psid, received_message.text, session);
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
    // Check if we already have a user record with this PSID
    const user = await User.findOne({ messengerPSID: psid });
    
    if (!user) {
      // We'll create a temporary user record for this PSID
      await User.create({
        messengerPSID: psid,
        role: "citizen",
        name: "Messenger User",
        email: `messenger_${psid}@temp.agapayalert.com`,
        validIdSubmitted: false,
        status: "active"
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
  // Check if text exists first
  if (!text) {
    return await sendResponse(psid, { 
      text: "Please provide the person's name as text, not an image or attachment:" 
    });
  }
  
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
  // Check if text exists
  if (!text) {
    return await sendResponse(psid, { 
      text: "Please provide the person's age as a number, not an image or attachment:" 
    });
  }
  
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
      currentStep: 'DESCRIPTION'
    },
    { new: true }
  );
  
  // Ask for description with examples
  const reportType = session.data.type || "Missing";
  let promptText = "Please describe what happened and when the person was last seen:";
  
  if (reportType.toLowerCase() === "missing") {
    promptText += "\n\nExample: \"Juan was last seen yesterday (June 15) around 3 PM at SM North EDSA. He was wearing a red t-shirt and jeans. He didn't return home after going to meet friends.\"";
  } else if (reportType.toLowerCase() === "absent") {
    promptText += "\n\nExample: \"Maria left home on June 14 after an argument. She took some clothes and her phone but hasn't responded to calls. She was wearing a blue dress when she left.\"";
  } else {
    promptText += "\n\nPlease include:\n- When last seen (date and time)\n- What they were wearing\n- Any circumstances about their disappearance\n- Any medical conditions they have";
  }
  
  await sendResponse(psid, { text: promptText });
}

// NEW: Handle description input
// Handle description input
async function handleDescriptionInput(psid, text, session) {
  if (!text || text.trim().length < 10) {
    return await sendResponse(psid, { 
      text: "Please provide more details about what happened. Include when the person was last seen, what they were wearing, and any circumstances about their disappearance:" 
    });
  }
  
  console.log(`Saving description for ${psid}: "${text.substring(0, 50)}${text.length > 50 ? '...' : ''}"`);
  
  // Update session with description - Save to both fields to ensure compatibility
  await MessengerReportSession.findOneAndUpdate(
    { psid },
    { 
      'data.messengerDescription': text.trim(),
      'data.description': text.trim(),
      currentStep: 'LOCATION'
    },
    { new: true }
  );
  
  await sendResponse(psid, { 
    text: "Thank you for the description. Now, please provide the last known location with as much detail as possible:" 
  });
}

async function handleLocationInput(psid, text, session) {
  // Check if text exists
  if (!text) {
    return await sendResponse(psid, { 
      text: "Please provide the location as text, not an image or attachment:" 
    });
  }
  
  const address = text.trim();
  
  if (address.length < 10) {
    return await sendResponse(psid, { 
      text: "Please provide more details about the location:" 
    });
  }
  
  // Improved address parsing using regex patterns for Philippine addresses
  let streetAddress = address;
  let barangay = "Unknown";
  let city = "Unknown";
  let zipCode = "Unknown";
  
  // Extract zip code if present
  const zipCodeMatch = address.match(/\b(\d{4})\b/);
  if (zipCodeMatch) {
    zipCode = zipCodeMatch[1];
  }
  
  // Try to extract city with more patterns
  const cityPatterns = [
    /(?:in|at|,)\s+([A-Za-z\s]+City|[A-Za-z\s]+Municipality)/i,  // "in Manila City" or "at Quezon City"
    /\b((?:Makati|Manila|Quezon|Taguig|Pasig|Pasay|Parañaque|Mandaluyong|Marikina|Caloocan|Valenzuela|Malabon|Navotas|Muntinlupa|Las Piñas|San Juan|Pateros)(?:\s+City)?)\b/i,  // Common Metro Manila cities
    /\b([A-Za-z]+(?:\s+[A-Za-z]+)?)\s*,\s*(?:Metro\s+Manila|NCR|[A-Za-z\s]+\b(?:Province|Islands))\b/i,  // "City, Province" pattern
    /\b([A-Za-z]+(?:\s+[A-Za-z]+)?)(?=\s*,\s*\d{4})/i  // City followed by comma and zip code
  ];
  
  // Try each pattern until we find a match
  for (const pattern of cityPatterns) {
    const cityMatch = address.match(pattern);
    if (cityMatch) {
      city = cityMatch[1].trim();
      break;
    }
  }
  
  // Try to extract barangay
  const barangayPatterns = [
    /(?:Brgy\.|Barangay|Bgy\.)\s+([A-Za-z0-9\s]+)(?:,|$)/i,
    /\bin\s+([A-Za-z0-9\s]+)\s+(?:barangay|brgy)/i
  ];
  
  for (const pattern of barangayPatterns) {
    const barangayMatch = address.match(pattern);
    if (barangayMatch) {
      barangay = barangayMatch[1].trim();
      break;
    }
  }
  
  // Update session with parsed address
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
  
  // Store raw address for direct geocoding
  await MessengerReportSession.findOneAndUpdate(
    { psid },
    { 'data.location.rawAddress': address }
  );
  
  // Try to geocode the address immediately with multiple approaches
  try {
    // First try with direct geocoding of the full address
    let geoData = await getCoordinatesFromAddress({ fullAddress: address });
    console.log("Geocoding result (raw):", geoData);
    
    // If that fails, try with parsed fields
    if (!geoData.success) {
      const addressObj = {
        streetAddress,
        barangay,
        city,
        zipCode
      };
      
      geoData = await getCoordinatesFromAddress(addressObj);
      console.log("Geocoding result (structured):", geoData);
    }
    
    // If successful, store coordinates
    if (geoData.success) {
      await MessengerReportSession.findOneAndUpdate(
        { psid },
        { 'data.location.coordinates': geoData.coordinates }
      );
    }
  } catch (error) {
    console.error("Error geocoding address:", error);
    // Continue without coordinates, we'll try again at submission
  }
  
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
          currentStep: 'CREDENTIAL'
        },
        { new: true }
      );
      
      // Ask for ID verification
      await sendResponse(psid, {
        text: "Please provide a valid ID or any credentials for verification (ID type and ID number):"
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

async function handleCredentialInput(psid, text, session) {
  // Check if text exists before trying to use trim()
  if (!text) {
    return await sendResponse(psid, {
      text: "Please provide your credentials as text (not an image or attachment):"
    });
  }

  if (text.trim().length < 5) {
    return await sendResponse(psid, {
      text: "Please provide more detailed credentials for verification. Example: \"Driver's License 123456\" or \"Voter's ID 789012345\""
    });
  }
  
  // Store the credentials
  await MessengerReportSession.findOneAndUpdate(
    { psid },
    {
      'data.credential': text.trim(),
      currentStep: 'CONFIRM'
    },
    { new: true }
  );
  
  // Get updated session with all report data
  const updatedSession = await MessengerReportSession.findOne({ psid });
  const reportData = updatedSession.data;
  
  // Get description to show in preview
  const description = reportData.messengerDescription || "No description provided";
  const shortDescription = description.length > 60 
    ? description.substring(0, 57) + "..." 
    : description;
  
  await sendResponse(psid, {
    attachment: {
      type: "template",
      payload: {
        template_type: "generic",
        elements: [{
          title: `${reportData.type} Report: ${reportData.personInvolved.firstName} ${reportData.personInvolved.lastName}`,
          subtitle: `Age: ${reportData.personInvolved.age}\nLocation: ${reportData.location.address.city}\nDesc: ${shortDescription}`,
          image_url: reportData.photo.url,
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
    
    // Clean up temp files
    if (fs.existsSync(tempFilePath)) {
      try {
        fs.unlinkSync(tempFilePath);
        console.log(`Successfully deleted temporary file: ${tempFilePath}`);
      } catch (unlinkError) {
        console.warn(`Warning: Could not delete temporary file ${tempFilePath}:`, unlinkError);
      }
    }
    
    return photoResult;
  } catch (error) {
    console.error('Error processing messenger photo:', error);
    return null;
  }
}

async function handleDescriptionInput(psid, text, session) {
  if (!text || text.trim().length < 10) {
    return await sendResponse(psid, { 
      text: "Please provide more details about what happened. Include when the person was last seen, what they were wearing, and any circumstances about their disappearance:" 
    });
  }
  
  // Update session with description - use proper field name
  await MessengerReportSession.findOneAndUpdate(
    { psid },
    { 
      'data.description': text.trim(), // Store under description field
      currentStep: 'LOCATION'
    },
    { new: true }
  );
  
  await sendResponse(psid, { 
    text: "Thank you for the description. Now, please provide the last known location with as much detail as possible (e.g., street address, barangay, city, zip code):" 
  });
}

// UPDATED: Modified submitReport function to include description and better coordinates handling
// Fixed submitReport function
async function submitReport(psid) {
  try {
    // Find session
    const session = await MessengerReportSession.findOne({ psid });
    if (!session) {
      return await sendResponse(psid, { text: "Your report session has expired. Please start again." });
    }
    
    console.log("Found session:", session._id);
    
    // Get session data
    const reportData = session.data;
    console.log("Report data:", JSON.stringify(reportData, null, 2));
    
    // Check if we have photo data
    if (!reportData.photo || !reportData.photo.url) {
      return await sendResponse(psid, { 
        text: "Missing photo information. Please restart the report process and upload a photo." 
      });
    }
    
    // Get coordinates
    const location = {
      address: {
        streetAddress: reportData.location?.address?.streetAddress || "Unknown",
        barangay: reportData.location?.address?.barangay || "Unknown",
        city: reportData.location?.address?.city || "Unknown",
        zipCode: reportData.location?.address?.zipCode || "Unknown"
      }
    };
    
    // Extract the description - from messengerDescription or description field
    const description = reportData.messengerDescription || reportData.description || "";
    console.log(`Description for report: "${description.substring(0, 50)}${description.length > 50 ? '...' : ''}"`);
    
    // Try to get coordinates from session
    let coordinates = reportData.location?.coordinates;
    
    // If no coordinates in session data, try geocoding
    if (!coordinates || !Array.isArray(coordinates) || coordinates.length !== 2) {
      const geoData = await getCoordinatesFromAddress(location.address);
      console.log("Geocoding result:", geoData);
      
      if (geoData.success) {
        coordinates = geoData.coordinates;
      } else {
        // Default to Manila if geocoding fails
        coordinates = [121.0244, 14.5547]; 
      }
    }
    
    // Find user if exists
    let user = await User.findOne({ messengerPSID: psid });
    let isAnonymous = !user;
    
    // Create a temporary user if needed
    if (!user) {
      try {
        console.log("No user found with PSID:", psid, "- Creating temporary user");
        user = await User.create({
          messengerPSID: psid,
          roles: ["citizen"],
          firstName: "Messenger",
          lastName: "User",
          email: `messenger_${psid}@temp.agapayalert.com`,
          isActive: true
        });
        console.log("Created temporary user:", user._id);
      } catch (userCreateError) {
        console.error("Failed to create temporary user:", userCreateError);
        // Continue without user - the report will be anonymous
      }
    }
    
    // Get user's selected police station if available, otherwise auto-assign
    const selectedPoliceStationId = reportData.selectedPoliceStation || null;
    const useAutoAssign = reportData.useAutoAssign !== false;
    
    // Find police station
    const assignedStation = await findPoliceStation(selectedPoliceStationId, coordinates, useAutoAssign);
    
    if (!assignedStation) {
      return await sendResponse(psid, { 
        text: "We couldn't find a police station to assign. Please provide more location details."
      });
    }
    
    console.log("Assigned station:", assignedStation._id);
    
    // Create report
    const report = new Report({
      reporter: user ? user._id : null,
      type: reportData.type,
      personInvolved: {
        firstName: reportData.personInvolved.firstName,
        lastName: reportData.personInvolved.lastName,
        age: reportData.personInvolved.age || 0,
        // Required fields
        dateOfBirth: new Date(Date.now() - ((reportData.personInvolved.age || 30) * 365 * 24 * 60 * 60 * 1000)),
        lastSeenDate: new Date(),
        lastSeentime: new Date().toTimeString().substring(0, 5),
        lastKnownLocation: location.address.streetAddress,
        relationship: "Not specified via messenger",
        gender: "Unknown", // Required field
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
      messengerDescription: description, // FIXED: Use messengerDescription instead of description
      stationAssignmentType: selectedPoliceStationId ? "manual" : "automatic", // FIXED: Use correct enum values
      isAnonymous: isAnonymous,
      messengerPSID: psid,
      validCredential: reportData.credential || "Messenger report",
      reportSource: "messenger",
      consentUpdateHistory: [
        {
          previousValue: false,
          newValue: true,
          updatedBy: user ? user._id : null,
          date: new Date(),
        }
      ]
    });
    
    // If anonymous, add additional info
    if (isAnonymous) {
      report.anonymousReporter = {
        contactInfo: `Messenger PSID: ${psid}`,
        messengerPSID: psid
      };
    }
    
    console.log("About to save report with data:", {
      type: report.type,
      reporter: report.reporter || "Via Messenger",
      firstName: report.personInvolved.firstName,
      lastName: report.personInvolved.lastName,
      coordinates: report.location.coordinates,
      photoUrl: report.personInvolved.mostRecentPhoto.url,
      descriptionLength: description ? description.length : 0
    });
    
    try {
      const savedReport = await report.save();
      console.log("Report saved successfully:", savedReport._id);
      
      // Generate case ID if needed
      if (!savedReport.caseId) {
        const prefix = savedReport.type.substring(0, 3).toUpperCase();
        const idSuffix = savedReport._id.toString().slice(-7);
        savedReport.caseId = `${prefix}-${idSuffix}`;
        await savedReport.save();
      }
      
      // Delete session after successful save
      await session.deleteOne();
      
      // Confirm to user
      const descriptionNote = description ? 
        "\n\nYour description has been saved with the report." : 
        "";
      
      await sendResponse(psid, { 
        text: `Thank you. Your report has been submitted successfully!\n\nCase ID: ${savedReport.caseId}\n\nIt has been assigned to ${assignedStation.name}.${descriptionNote}` 
      });
    } catch (saveError) {
      console.error("Error saving report:", saveError);
      
      // Check for validation errors
      if (saveError.name === 'ValidationError') {
        console.error("Validation errors:", saveError.errors);
        
        const errorFields = Object.keys(saveError.errors).join(", ");
        
        await sendResponse(psid, { 
          text: `We encountered validation errors with these fields: ${errorFields}. Please try again or use the AgapayAlert app.` 
        });
      } else {
        await sendResponse(psid, { 
          text: "We encountered an error while saving your report. Please try again or use the AgapayAlert app." 
        });
      }
    }
  } catch (error) {
    console.error('Error in submitReport:', error);
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

// Validate report data
async function validateReportData(reportData) {
  // Check minimal required fields
  const requiredFields = [
    'type',
    'personInvolved.firstName',
    'personInvolved.lastName',
    'personInvolved.mostRecentPhoto.url',
    'personInvolved.mostRecentPhoto.public_id',
    'location.coordinates',
    'location.address.streetAddress',
    'location.address.barangay',
    'location.address.city',
    'location.address.zipCode',
    'assignedPoliceStation',
    'reporter' // We require a reporter
  ];
  
  const missingFields = [];
  
  // Helper function to check nested fields
  function checkNestedField(obj, fieldPath) {
    const parts = fieldPath.split('.');
    let current = obj;
    
    for (const part of parts) {
      if (current === undefined || current === null || !current.hasOwnProperty(part)) {
        return false;
      }
      current = current[part];
    }
    
    return current !== undefined && current !== null && current !== '';
  }
  
  for (const field of requiredFields) {
    if (!checkNestedField(reportData, field)) {
      missingFields.push(field);
    }
  }
  
  return {
    isValid: missingFields.length === 0,
    missingFields
  };
}

exports.sendCustomMessage = async (psid, message) => {
  return await sendResponse(psid, { text: message });
};

// Export everything properly
module.exports = {
  initializeMessenger: exports.initializeMessenger,
  handleMessage: exports.handleMessage,
  handlePostback: exports.handlePostback,
  sendCustomMessage: exports.sendCustomMessage,
};
// const axios = require("axios");
// const User = require("../models/userModel");
// const Report = require("../models/reportModel");
// const PoliceStation = require("../models/policeStationModel");
// const MessengerReportSession = require("../models/MessengerReportSessionModel");
// const { getCoordinatesFromAddress } = require("../utils/geocoding");
// const uploadToCloudinary = require("../utils/uploadToCloudinary");
// const fs = require('fs');
// const path = require('path');
// const FB_API_VERSION = 'v22.0';
// const FB_API_BASE = `https://graph.facebook.com/${FB_API_VERSION}`;

// //find police station
// const findPoliceStation = async (selectedId, coordinates) => {
//   if (selectedId) {
//     const selected = await PoliceStation.findById(selectedId);
//     if (selected) return selected;
//   }

//   // Find nearest within 5km
//   const nearest = await PoliceStation.findOne({
//     location: {
//       $near: {
//         $geometry: {
//           type: "Point",
//           coordinates,
//         },
//         $maxDistance: 5000,
//       },
//     },
//   });

//   // If no station within 5km, find absolute nearest
//   if (!nearest) {
//     return await PoliceStation.findOne({
//       location: {
//         $near: {
//           $geometry: {
//             type: "Point",
//             coordinates,
//           },
//         },
//       },
//     });
//   }

//   return nearest;
// };

// exports.initializeMessenger = async () => {
//   try {
//     console.log('🔄 Initializing Messenger profile...');

//     // Set up messenger profile
//     await axios.post(
//       `${FB_API_BASE}/me/messenger_profile`,
//       {
//         get_started: {
//           payload: "GET_STARTED"
//         },
//         greeting: [{
//           locale: "default",
//           text: "Welcome to AgapayAlert! Click Get Started to begin."
//         }],
//         persistent_menu: [{
//           locale: "default",
//           composer_input_disabled: false,
//           call_to_actions: [
//             {
//               type: "postback",
//               title: "Get Started",
//               payload: "GET_STARTED"
//             },
//             {
//               type: "web_url",
//               title: "Visit Website",
//               url: "https://jsond.onrender.com/"
//             }
//           ]
//         }]
//       },
//       {
//         headers: { 'Content-Type': 'application/json' },
//         params: { access_token: process.env.FACEBOOK_PAGE_ACCESS_TOKEN }
//       }
//     );

//     console.log('✅ Messenger profile initialized');
//     return true;
//   } catch (error) {
//     console.error('❌ Error initializing messenger:', error.response?.data || error);
//     return false;
//   }
// };

// exports.handleMessage = async (sender_psid, received_message) => {
//   try {
//     console.log('📨 New message from:', sender_psid);

//     // Send welcome message with buttons
//     await sendResponse(sender_psid, {
//       attachment: {
//         type: "template",
//         payload: {
//           template_type: "button",
//           text: "Welcome to AgapayAlert! 👋\nClick the button below to get started:",
//           buttons: [
//             {
//               type: "postback",
//               title: "Get Started",
//               payload: "GET_STARTED"
//             }
//           ]
//         }
//       }
//     });

//   } catch (error) {
//     console.error('❌ Error handling message:', error);
//   }
// };

// exports.handlePostback = async (sender_psid, postback) => {
//   try {
//     console.log('🔄 Processing postback:', postback.payload);

//     if (postback.payload === 'GET_STARTED') {
//       // Existing GET_STARTED logic...
//       await sendResponse(sender_psid, {
//         text: `Thank you for connecting with AgapayAlert! 🚨\n\nYour PSID is: ${sender_psid}\n\nSave this PSID to link your account in the AgapayAlert app.`
//       });

//       // Store PSID
//       await User.findOneAndUpdate(
//         { messengerPSID: sender_psid },
//         { messengerPSID: sender_psid },
//         { upsert: true, new: true }
//       );

//       // Add Create Report option to the menu
//       await sendResponse(sender_psid, {
//         attachment: {
//           type: "template",
//           payload: {
//             template_type: "generic",
//             elements: [{
//               title: "AgapayAlert Services",
//               subtitle: "Get real-time alerts and report missing persons",
//               image_url: "https://agapayalert-web.onrender.com/assets/AGAPAYALERT%20-%20imagotype-CfBGhIL1.svg",
//               buttons: [
//                 {
//                   type: "postback",
//                   title: "Create Report",
//                   payload: "CREATE_REPORT"
//                 },
//                 {
//                   type: "postback",
//                   title: "About Us",
//                   payload: "ABOUT_US"
//                 },
//                 {
//                   type: "web_url",
//                   url: "https://agapayalert-web.onrender.com/",
//                   title: "Visit Website"
//                 }
//               ]
//             }]
//           }
//         }
//       });
//     } else if (postback.payload === "ABOUT_US") {
//       // Existing ABOUT_US logic...
//     } else if (postback.payload === "CREATE_REPORT") {
//       await startReportFlow(sender_psid);
//     } else if (postback.payload.startsWith("REPORT_TYPE_")) {
//       const reportType = postback.payload.replace("REPORT_TYPE_", "");
//       await handleReportTypeSelection(sender_psid, reportType);
//     } else if (postback.payload === "REPORT_MORE_TYPES") {
//       await sendMoreReportTypes(sender_psid);
//     } else if (postback.payload === "SUBMIT_REPORT") {
//       await submitReport(sender_psid);
//     } else if (postback.payload === "CANCEL_REPORT") {
//       await cancelReport(sender_psid);
//     }
//   } catch (error) {
//     console.error('❌ Error handling postback:', error);
//   }
// };

// // Update handleMessage function to process report inputs
// exports.handleMessage = async (sender_psid, received_message) => {
//   try {
//     console.log('📨 New message from:', sender_psid);

//     // Check if user is in a report flow
//     const session = await MessengerReportSession.findOne({ psid: sender_psid });

//     if (session) {
//       // Process based on current step
//       switch(session.currentStep) {
//         case 'PERSON_NAME':
//           return await handlePersonNameInput(sender_psid, received_message.text, session);
//         case 'PERSON_AGE':
//           return await handlePersonAgeInput(sender_psid, received_message.text, session);
//         case 'LOCATION':
//           return await handleLocationInput(sender_psid, received_message.text, session);
//         case 'PHOTO':
//           return await handlePhotoInput(sender_psid, received_message, session);
//         default:
//           // Welcome message for other steps
//           await sendReportMenu(sender_psid);
//           return;
//       }
//     }

//     // Default response for non-report flow
//     await sendResponse(sender_psid, {
//       attachment: {
//         type: "template",
//         payload: {
//           template_type: "button",
//           text: "Hello! What would you like to do today?",
//           buttons: [
//             {
//               type: "postback",
//               title: "Create a Report",
//               payload: "CREATE_REPORT"
//             },
//             {
//               type: "postback",
//               title: "About AgapayAlert",
//               payload: "ABOUT_US"
//             }
//           ]
//         }
//       }
//     });
//   } catch (error) {
//     console.error('❌ Error handling message:', error);
//   }
// };

// // Report flow functions
// async function startReportFlow(psid) {
//   try {
//     // Check if user is linked to an account
//     const user = await User.findOne({ messengerPSID: psid });
//     if (!user) {
//       return await sendResponse(psid, {
//         text: "You need to link your Messenger account to an AgapayAlert account first. Please register in the app and link your account using your PSID."
//       });
//     }

//     // Create or reset session
//     await MessengerReportSession.findOneAndUpdate(
//       { psid },
//       {
//         psid,
//         currentStep: 'TYPE',
//         data: {}
//       },
//       { upsert: true, new: true }
//     );

//     // Send report type options
//     await sendResponse(psid, {
//       attachment: {
//         type: "template",
//         payload: {
//           template_type: "button",
//           text: "What type of report would you like to submit?",
//           buttons: [
//             {
//               type: "postback",
//               title: "Missing Person",
//               payload: "REPORT_TYPE_Missing"
//             },
//             {
//               type: "postback",
//               title: "Absent Person",
//               payload: "REPORT_TYPE_Absent"
//             },
//             {
//               type: "postback",
//               title: "More Options",
//               payload: "REPORT_MORE_TYPES"
//             }
//           ]
//         }
//       }
//     });
//   } catch (error) {
//     console.error('Error starting report flow:', error);
//     await sendResponse(psid, { text: "Sorry, we encountered an error. Please try again later." });
//   }
// }

// async function sendMoreReportTypes(psid) {
//   await sendResponse(psid, {
//     attachment: {
//       type: "template",
//       payload: {
//         template_type: "button",
//         text: "Additional report types:",
//         buttons: [
//           {
//             type: "postback",
//             title: "Abducted Person",
//             payload: "REPORT_TYPE_Abducted"
//           },
//           {
//             type: "postback",
//             title: "Kidnapped Person",
//             payload: "REPORT_TYPE_Kidnapped"
//           },
//           {
//             type: "postback",
//             title: "Hit-and-Run",
//             payload: "REPORT_TYPE_Hit-and-Run"
//           }
//         ]
//       }
//     }
//   });
// }

// async function handleReportTypeSelection(psid, reportType) {
//   // Update session with report type
//   await MessengerReportSession.findOneAndUpdate(
//     { psid },
//     {
//       'data.type': reportType,
//       currentStep: 'PERSON_NAME'
//     },
//     { new: true }
//   );

//   // Ask for person's name
//   await sendResponse(psid, {
//     text: "Please enter the person's full name (First and Last name):"
//   });
// }

// async function handlePersonNameInput(psid, text, session) {
//   // Simple name parsing
//   const nameParts = text.trim().split(' ');
//   let firstName = nameParts[0];
//   let lastName = nameParts.length > 1 ? nameParts.slice(1).join(' ') : '';

//   if (!firstName || !lastName) {
//     return await sendResponse(psid, {
//       text: "Please provide both first and last name (e.g., Juan Dela Cruz):"
//     });
//   }

//   // Update session
//   await MessengerReportSession.findOneAndUpdate(
//     { psid },
//     {
//       'data.personInvolved.firstName': firstName,
//       'data.personInvolved.lastName': lastName,
//       currentStep: 'PERSON_AGE'
//     },
//     { new: true }
//   );

//   // Ask for person's age
//   await sendResponse(psid, {
//     text: "Please enter the person's age:"
//   });
// }

// async function handlePersonAgeInput(psid, text, session) {
//   const age = parseInt(text.trim());

//   if (isNaN(age) || age < 0 || age > 120) {
//     return await sendResponse(psid, {
//       text: "Please enter a valid age (0-120):"
//     });
//   }

//   // Update session
//   await MessengerReportSession.findOneAndUpdate(
//     { psid },
//     {
//       'data.personInvolved.age': age,
//       currentStep: 'LOCATION'
//     },
//     { new: true }
//   );

//   // Ask for location
//   await sendResponse(psid, {
//     text: "Please provide the last known location (include street, barangay, city and zip code if possible):"
//   });
// }

// async function handleLocationInput(psid, text, session) {
//   const address = text.trim();

//   if (address.length < 10) {
//     return await sendResponse(psid, {
//       text: "Please provide more details about the location:"
//     });
//   }

//   // Simple address parsing - in production you would need a more sophisticated parser
//   let streetAddress = address;
//   let barangay = "Unknown";
//   let city = "Unknown";
//   let zipCode = "Unknown";

//   // Try to extract city from the address
//   const cityMatch = address.match(/(?:in|at|,)\s+([A-Za-z\s]+City|[A-Za-z\s]+Municipality)/i);
//   if (cityMatch) {
//     city = cityMatch[1].trim();
//   }

//   // Update session
//   await MessengerReportSession.findOneAndUpdate(
//     { psid },
//     {
//       'data.location.address.streetAddress': streetAddress,
//       'data.location.address.barangay': barangay,
//       'data.location.address.city': city,
//       'data.location.address.zipCode': zipCode,
//       currentStep: 'PHOTO'
//     },
//     { new: true }
//   );

//   // Ask for photo
//   await sendResponse(psid, {
//     text: "Please upload a recent photo of the person:"
//   });
// }

// async function handlePhotoInput(psid, message, session) {
//   try {
//     // Check if message contains an image attachment
//     if (message.attachments && message.attachments[0] && message.attachments[0].type === 'image') {
//       const photoUrl = message.attachments[0].payload.url;

//       // Process photo right away to avoid issues later
//       const photoResult = await processMessengerPhoto(photoUrl, psid);

//       if (!photoResult) {
//         return await sendResponse(psid, {
//           text: "We had trouble processing your photo. Please try uploading it again."
//         });
//       }

//       // Update session with processed image info
//       await MessengerReportSession.findOneAndUpdate(
//         { psid },
//         {
//           'data.photo': {
//             url: photoResult.url,
//             public_id: photoResult.public_id
//           },
//           currentStep: 'CONFIRM'
//         },
//         { new: true }
//       );

//       // Get updated session
//       const updatedSession = await MessengerReportSession.findOne({ psid });
//       const reportData = updatedSession.data;

//       // Show confirmation with image preview
//       await sendResponse(psid, {
//         attachment: {
//           type: "template",
//           payload: {
//             template_type: "generic",
//             elements: [{
//               title: "Report Preview",
//               subtitle: `Type: ${reportData.type}\nName: ${reportData.personInvolved.firstName} ${reportData.personInvolved.lastName}`,
//               image_url: photoResult.url,
//               buttons: [
//                 {
//                   type: "postback",
//                   title: "Submit Report",
//                   payload: "SUBMIT_REPORT"
//                 },
//                 {
//                   type: "postback",
//                   title: "Cancel",
//                   payload: "CANCEL_REPORT"
//                 }
//               ]
//             }]
//           }
//         }
//       });
//     } else {
//       await sendResponse(psid, {
//         text: "Please upload a photo of the person (tap the + button and select Gallery):"
//       });
//     }
//   } catch (error) {
//     console.error('Error processing photo:', error);
//     await sendResponse(psid, {
//       text: "We encountered an error while processing your photo. Please try again."
//     });
//   }
// }
// /**
//  * Process and upload photo from Messenger to Cloudinary
//  * @param {string} photoUrl - URL of the photo from Messenger
//  * @param {string} psid - Sender's PSID for naming the temp file
//  * @returns {Promise<Object|null>} - Cloudinary upload result or null if failed
//  */
// async function processMessengerPhoto(photoUrl, psid) {
//   try {
//     // Download image from Facebook
//     const response = await axios.get(photoUrl, {
//       responseType: 'arraybuffer',
//       timeout: 10000 // 10 second timeout
//     });

//     const buffer = Buffer.from(response.data, 'binary');

//     // Validate image size (10MB max)
//     if (buffer.length > 10 * 1024 * 1024) {
//       console.error('Image too large:', buffer.length / (1024 * 1024), 'MB');
//       return null;
//     }

//     // Create temp directory if it doesn't exist
//     const tempDir = path.join(__dirname, '../uploads');
//     if (!fs.existsSync(tempDir)) {
//       fs.mkdirSync(tempDir, { recursive: true });
//     }

//     const tempFilePath = path.join(tempDir, `messenger_${psid}_${Date.now()}.jpg`);
//     fs.writeFileSync(tempFilePath, buffer);

//     // Upload to Cloudinary with optimization options
//     const photoResult = await uploadToCloudinary(tempFilePath, "messenger_reports", 'image');

//     // Uncomment and fix this section to clean up temp files
//     if (fs.existsSync(tempFilePath)) {
//       try {
//         fs.unlinkSync(tempFilePath);
//         console.log(`Successfully deleted temporary file: ${tempFilePath}`);
//       } catch (unlinkError) {
//         console.warn(`Warning: Could not delete temporary file ${tempFilePath}:`, unlinkError);
//       }
//     }

//     return photoResult;
//   } catch (error) {
//     console.error('Error processing messenger photo:', error);
//     return null;
//   }
// }

// async function submitReport(psid) {
//   try {
//     // Find session
//     const session = await MessengerReportSession.findOne({ psid });
//     if (!session) {
//       return await sendResponse(psid, { text: "Your report session has expired. Please start again." });
//     }

//     console.log("Found session:", session._id);

//     // Find user
//     const user = await User.findOne({ messengerPSID: psid });
//     if (!user) {
//       return await sendResponse(psid, {
//         text: "Your Facebook account needs to be linked to an AgapayAlert account to submit reports."
//       });
//     }

//     console.log("Found user:", user._id);

//     // Get session data
//     const reportData = session.data;
//     console.log("Report data:", JSON.stringify(reportData, null, 2));

//     // Check if we have photo data
//     if (!reportData.photo || !reportData.photo.url) {
//       return await sendResponse(psid, {
//         text: "Missing photo information. Please restart the report process and upload a photo."
//       });
//     }

//     // Get coordinates
//     const location = {
//       address: {
//         streetAddress: reportData.location.address.streetAddress || "Unknown",
//         barangay: reportData.location.address.barangay || "Unknown",
//         city: reportData.location.address.city || "Unknown",
//         zipCode: reportData.location.address.zipCode || "Unknown"
//       }
//     };

//     const geoData = await getCoordinatesFromAddress(location.address);
//     console.log("Geocoding result:", geoData);

//     if (!geoData.success) {
//       await sendResponse(psid, {
//         text: "We couldn't process the location precisely. Please provide more details in the app later."
//       });
//       // Continue with approximate coordinates
//     }

//     // Find police station
//     const coordinates = geoData.success ? geoData.coordinates : [0, 0];
//     const assignedStation = await findPoliceStation(null, coordinates);

//     if (!assignedStation) {
//       return await sendResponse(psid, {
//         text: "We couldn't find a police station to assign. Please submit your report through the app."
//       });
//     }

//     console.log("Assigned station:", assignedStation._id);

//     // Create report
//     const report = new Report({
//       reporter: user._id,
//       type: reportData.type,
//       personInvolved: {
//         firstName: reportData.personInvolved.firstName,
//         lastName: reportData.personInvolved.lastName,
//         age: reportData.personInvolved.age,
//         // Required fields with default values
//         dateOfBirth: new Date(Date.now() - (reportData.personInvolved.age * 365 * 24 * 60 * 60 * 1000)), // Approximate from age
//         lastSeenDate: new Date(),
//         lastSeentime: new Date().toTimeString().substring(0, 5),
//         lastKnownLocation: reportData.location.address.streetAddress,
//         relationship: "Not specified via messenger",
//         mostRecentPhoto: {
//           url: reportData.photo.url,
//           public_id: reportData.photo.public_id,
//         }
//       },
//       location: {
//         type: "Point",
//         coordinates: coordinates,
//         address: location.address
//       },
//       assignedPoliceStation: assignedStation._id,
//       broadcastConsent: true,
//       consentUpdateHistory: [
//         {
//           previousValue: false,
//           newValue: true,
//           updatedBy: user._id,
//           date: new Date(),
//         }
//       ]
//     });

//     console.log("About to save report with data:", {
//       type: report.type,
//       reporter: report.reporter,
//       firstName: report.personInvolved.firstName,
//       lastName: report.personInvolved.lastName,
//       coordinates: report.location.coordinates,
//       photoUrl: report.personInvolved.mostRecentPhoto.url
//     });

//     // Save with explicit error handling
//     try {
//       const savedReport = await report.save();
//       console.log("Report saved successfully:", savedReport._id, savedReport.caseId);

//       // Delete session only after successful save
//       await session.deleteOne();

//       // Confirm to user
//       await sendResponse(psid, {
//         text: `Thank you. Your report has been submitted successfully!\n\nCase ID: ${savedReport.caseId}\n\nIt has been assigned to ${assignedStation.name}.\n\nYou can view and update this report in the AgapayAlert app.`
//       });
//     } catch (saveError) {
//       console.error("Error saving report:", saveError);

//       // Check for validation errors
//       if (saveError.name === 'ValidationError') {
//         console.error("Validation errors:", saveError.errors);

//         const errorMessages = Object.keys(saveError.errors).map(field =>
//           `${field}: ${saveError.errors[field].message}`
//         ).join('\n');

//         await sendResponse(psid, {
//           text: `We encountered validation errors while creating your report:\n\n${errorMessages}\n\nPlease try again or use the AgapayAlert app.`
//         });
//       } else {
//         await sendResponse(psid, {
//           text: "We encountered an error while saving your report. Please try again or use the AgapayAlert app."
//         });
//       }
//     }
//   } catch (error) {
//     console.error('Error in submitReport:', error);
//     await sendResponse(psid, {
//       text: "We encountered an error while submitting your report. Please try again or use the AgapayAlert app."
//     });
//   }
// }

// async function cancelReport(psid) {
//   // Delete the session
//   await MessengerReportSession.deleteOne({ psid });

//   // Confirm cancellation
//   await sendResponse(psid, {
//     text: "Your report has been cancelled. How else can I help you?"
//   });

//   // Send report menu again
//   await sendReportMenu(psid);
// }

// async function sendReportMenu(psid) {
//   await sendResponse(psid, {
//     attachment: {
//       type: "template",
//       payload: {
//         template_type: "button",
//         text: "What would you like to do?",
//         buttons: [
//           {
//             type: "postback",
//             title: "Create Report",
//             payload: "CREATE_REPORT"
//           },
//           {
//             type: "postback",
//             title: "About Us",
//             payload: "ABOUT_US"
//           },
//           {
//             type: "web_url",
//             url: "https://agapayalert-web.onrender.com/",
//             title: "Visit Website"
//           }
//         ]
//       }
//     }
//   });
// }

// async function sendResponse(sender_psid, response) {
//   try {
//     await axios.post(
//       `${FB_API_BASE}/me/messages`,
//       {
//         recipient: { id: sender_psid },
//         message: response,
//         messaging_type: "RESPONSE"
//       },
//       {
//         headers: { 'Content-Type': 'application/json' },
//         params: { access_token: process.env.FACEBOOK_PAGE_ACCESS_TOKEN }
//       }
//     );
//     console.log('✅ Message sent to:', sender_psid);
//   } catch (error) {
//     console.error('❌ Error sending message:', error.response?.data || error);
//     throw error;
//   }
// }

// // Add this function to your controller
// async function validateReportData(reportData) {
//   // Check minimal required fields
//   const requiredFields = [
//     'type',
//     'personInvolved.firstName',
//     'personInvolved.lastName',
//     'personInvolved.mostRecentPhoto.url',
//     'personInvolved.mostRecentPhoto.public_id',
//     'location.coordinates',
//     'location.address.streetAddress',
//     'location.address.barangay',
//     'location.address.city',
//     'location.address.zipCode',
//     'assignedPoliceStation',
//     'reporter'
//   ];

//   const missingFields = [];

//   // Helper function to check nested fields
//   function checkNestedField(obj, fieldPath) {
//     const parts = fieldPath.split('.');
//     let current = obj;

//     for (const part of parts) {
//       if (current === undefined || current === null || !current.hasOwnProperty(part)) {
//         return false;
//       }
//       current = current[part];
//     }

//     return current !== undefined && current !== null && current !== '';
//   }

//   for (const field of requiredFields) {
//     if (!checkNestedField(reportData, field)) {
//       missingFields.push(field);
//     }
//   }

//   return {
//     isValid: missingFields.length === 0,
//     missingFields
//   };
// }

// exports.sendCustomMessage = async (psid, message) => {
//   return await sendResponse(psid, { text: message });
// };

// const axios = require("axios");
// const User = require("../models/userModel");
// const Report = require("../models/reportModel");
// const PoliceStation = require("../models/policeStationModel");
// const MessengerReportSession = require("../models/MessengerReportSessionModel");
// const { getCoordinatesFromAddress } = require("../utils/geocoding");
// const uploadToCloudinary = require("../utils/uploadToCloudinary");
// const fs = require("fs");
// const path = require("path");
// const FB_API_VERSION = "v22.0";
// const FB_API_BASE = `https://graph.facebook.com/${FB_API_VERSION}`;

// // Modified findPoliceStation function to respect user selection
// const findPoliceStation = async (selectedId, coordinates, useAutoAssign = false) => {
//   if (selectedId) {
//     const selected = await PoliceStation.findById(selectedId);
//     if (selected) return selected;
//   }

//   // Find nearest within 5km
//   const nearest = await PoliceStation.findOne({
//     location: {
//       $near: {
//         $geometry: {
//           type: "Point",
//           coordinates,
//         },
//         $maxDistance: 5000,
//       },
//     },
//   });

//   // If no station within 5km, find absolute nearest
//   if (!nearest) {
//     return await PoliceStation.findOne({
//       location: {
//         $near: {
//           $geometry: {
//             type: "Point",
//             coordinates,
//           },
//         },
//       },
//     });
//   }

//   return nearest;
// };

// exports.initializeMessenger = async () => {
//   try {
//     console.log("🔄 Initializing Messenger profile...");

//     // Set up messenger profile
//     await axios.post(
//       `${FB_API_BASE}/me/messenger_profile`,
//       {
//         get_started: {
//           payload: "GET_STARTED",
//         },
//         greeting: [
//           {
//             locale: "default",
//             text: "Welcome to AgapayAlert! Click Get Started to begin.",
//           },
//         ],
//         persistent_menu: [
//           {
//             locale: "default",
//             composer_input_disabled: false,
//             call_to_actions: [
//               {
//                 type: "postback",
//                 title: "Get Started",
//                 payload: "GET_STARTED",
//               },
//               {
//                 type: "web_url",
//                 title: "Visit Website",
//                 url: "https://jsond.onrender.com/",
//               },
//             ],
//           },
//         ],
//       },
//       {
//         headers: { "Content-Type": "application/json" },
//         params: { access_token: process.env.FACEBOOK_PAGE_ACCESS_TOKEN },
//       }
//     );

//     console.log("✅ Messenger profile initialized");
//     return true;
//   } catch (error) {
//     console.error("❌ Error initializing messenger:", error.response?.data || error);
//     return false;
//   }
// };

// exports.handlePostback = async (sender_psid, postback) => {
//   try {
//     console.log("🔄 Processing postback:", postback.payload);

//     if (postback.payload === "GET_STARTED") {
//       // Existing GET_STARTED logic...
//       await sendResponse(sender_psid, {
//         text: `Thank you for connecting with AgapayAlert! 🚨\n\nYour PSID is: ${sender_psid}\n\nSave this PSID to link your account in the AgapayAlert app.`,
//       });

//       // Store PSID for later linking
//       await User.findOneAndUpdate(
//         { messengerPSID: sender_psid },
//         { messengerPSID: sender_psid },
//         { upsert: true, new: true }
//       );

//       // Add Create Report option to the menu
//       await sendResponse(sender_psid, {
//         attachment: {
//           type: "template",
//           payload: {
//             template_type: "generic",
//             elements: [
//               {
//                 title: "AgapayAlert Services",
//                 subtitle: "Get real-time alerts and report missing persons",
//                 image_url: "https://agapayalert-web.onrender.com/assets/AGAPAYALERT%20-%20imagotype-CfBGhIL1.svg",
//                 buttons: [
//                   {
//                     type: "postback",
//                     title: "Create Report",
//                     payload: "CREATE_REPORT",
//                   },
//                   {
//                     type: "postback",
//                     title: "About Us",
//                     payload: "ABOUT_US",
//                   },
//                   {
//                     type: "web_url",
//                     url: "https://agapayalert-web.onrender.com/",
//                     title: "Visit Website",
//                   },
//                 ],
//               },
//             ],
//           },
//         },
//       });
//     } else if (postback.payload === "ABOUT_US") {
//       // About us logic goes here
//       await sendResponse(sender_psid, {
//         text: "AgapayAlert is an emergency response platform connecting citizens with local authorities for quick assistance during emergencies and missing person cases.",
//       });
//     } else if (postback.payload === "CREATE_REPORT") {
//       await startReportFlow(sender_psid);
//     } else if (postback.payload.startsWith("REPORT_TYPE_")) {
//       const reportType = postback.payload.replace("REPORT_TYPE_", "");
//       await handleReportTypeSelection(sender_psid, reportType);
//     } else if (postback.payload === "REPORT_MORE_TYPES") {
//       await sendMoreReportTypes(sender_psid);
//     } else if (postback.payload === "SUBMIT_REPORT") {
//       await submitReport(sender_psid);
//     } else if (postback.payload === "CANCEL_REPORT") {
//       await cancelReport(sender_psid);
//     }
//   } catch (error) {
//     console.error("❌ Error handling postback:", error);
//   }
// };

// // Update handleMessage function to process report inputs
// exports.handleMessage = async (sender_psid, received_message) => {
//   try {
//     console.log("📨 New message from:", sender_psid);

//     // Check if user is in a report flow
//     const session = await MessengerReportSession.findOne({ psid: sender_psid });

//     if (session) {
//       // Process based on current step
//       switch (session.currentStep) {
//         case "PERSON_NAME":
//           return await handlePersonNameInput(sender_psid, received_message.text, session);
//         case "PERSON_AGE":
//           return await handlePersonAgeInput(sender_psid, received_message.text, session);
//         case "LOCATION":
//           return await handleLocationInput(sender_psid, received_message.text, session);
//         case "PHOTO":
//           return await handlePhotoInput(sender_psid, received_message, session);
//         case "CREDENTIAL":
//           return await handleCredentialInput(sender_psid, received_message.text, session);
//         default:
//           // Welcome message for other steps
//           await sendReportMenu(sender_psid);
//           return;
//       }
//     }

//     // Default response for non-report flow
//     await sendResponse(sender_psid, {
//       attachment: {
//         type: "template",
//         payload: {
//           template_type: "button",
//           text: "Hello! What would you like to do today?",
//           buttons: [
//             {
//               type: "postback",
//               title: "Create a Report",
//               payload: "CREATE_REPORT",
//             },
//             {
//               type: "postback",
//               title: "About AgapayAlert",
//               payload: "ABOUT_US",
//             },
//           ],
//         },
//       },
//     });
//   } catch (error) {
//     console.error("❌ Error handling message:", error);
//   }
// };

// // Report flow functions
// async function startReportFlow(psid) {
//   try {
//     // Check if we already have a user record with this PSID
//     const user = await User.findOne({ messengerPSID: psid });

//     if (!user) {
//       // We'll create a temporary user record for this PSID
//       await User.create({
//         messengerPSID: psid,
//         role: "citizen",
//         name: "Messenger User",
//         email: `messenger_${psid}@temp.agapayalert.com`,
//         validIdSubmitted: false,
//         status: "active",
//       });
//     }

//     // Create or reset session
//     await MessengerReportSession.findOneAndUpdate(
//       { psid },
//       {
//         psid,
//         currentStep: "TYPE",
//         data: {},
//       },
//       { upsert: true, new: true }
//     );

//     // Send report type options
//     await sendResponse(psid, {
//       attachment: {
//         type: "template",
//         payload: {
//           template_type: "button",
//           text: "What type of report would you like to submit?",
//           buttons: [
//             {
//               type: "postback",
//               title: "Missing Person",
//               payload: "REPORT_TYPE_Missing",
//             },
//             {
//               type: "postback",
//               title: "Absent Person",
//               payload: "REPORT_TYPE_Absent",
//             },
//             {
//               type: "postback",
//               title: "More Options",
//               payload: "REPORT_MORE_TYPES",
//             },
//           ],
//         },
//       },
//     });
//   } catch (error) {
//     console.error("Error starting report flow:", error);
//     await sendResponse(psid, { text: "Sorry, we encountered an error. Please try again later." });
//   }
// }

// async function sendMoreReportTypes(psid) {
//   await sendResponse(psid, {
//     attachment: {
//       type: "template",
//       payload: {
//         template_type: "button",
//         text: "Additional report types:",
//         buttons: [
//           {
//             type: "postback",
//             title: "Abducted Person",
//             payload: "REPORT_TYPE_Abducted",
//           },
//           {
//             type: "postback",
//             title: "Kidnapped Person",
//             payload: "REPORT_TYPE_Kidnapped",
//           },
//           {
//             type: "postback",
//             title: "Hit-and-Run",
//             payload: "REPORT_TYPE_Hit-and-Run",
//           },
//         ],
//       },
//     },
//   });
// }

// async function handleReportTypeSelection(psid, reportType) {
//   // Update session with report type
//   await MessengerReportSession.findOneAndUpdate(
//     { psid },
//     {
//       "data.type": reportType,
//       currentStep: "PERSON_NAME",
//     },
//     { new: true }
//   );

//   // Ask for person's name
//   await sendResponse(psid, {
//     text: "Please enter the person's full name (First and Last name):",
//   });
// }

// async function handlePersonNameInput(psid, text, session) {
//   // Simple name parsing
//   const nameParts = text.trim().split(" ");
//   let firstName = nameParts[0];
//   let lastName = nameParts.length > 1 ? nameParts.slice(1).join(" ") : "";

//   if (!text) {
//     return await sendResponse(psid, {
//       text: "Please provide the person's name as text, not an image or attachment:",
//     });
//   }
//   if (!firstName || !lastName) {
//     return await sendResponse(psid, {
//       text: "Please provide both first and last name (e.g., Juan Dela Cruz):",
//     });
//   }

//   // Update session
//   await MessengerReportSession.findOneAndUpdate(
//     { psid },
//     {
//       "data.personInvolved.firstName": firstName,
//       "data.personInvolved.lastName": lastName,
//       currentStep: "PERSON_AGE",
//     },
//     { new: true }
//   );

//   // Ask for person's age
//   await sendResponse(psid, {
//     text: "Please enter the person's age:",
//   });
// }

// async function handlePersonAgeInput(psid, text, session) {
//   const age = parseInt(text.trim());

//   if (isNaN(age) || age < 0 || age > 120) {
//     return await sendResponse(psid, {
//       text: "Please enter a valid age (0-120):",
//     });
//   }

//   // Update session
//   await MessengerReportSession.findOneAndUpdate(
//     { psid },
//     {
//       "data.personInvolved.age": age,
//       currentStep: "LOCATION",
//     },
//     { new: true }
//   );

//   // Ask for location
//   await sendResponse(psid, {
//     text: "Please provide the last known location (include street, barangay, city and zip code if possible):",
//   });
// }

// async function handleLocationInput(psid, text, session) {
//   const address = text.trim();

//   if (address.length < 10) {
//     return await sendResponse(psid, {
//       text: "Please provide more details about the location:",
//     });
//   }

//   // Improved address parsing using regex patterns for Philippine addresses
//   let streetAddress = address;
//   let barangay = "Unknown";
//   let city = "Unknown";
//   let zipCode = "Unknown";

//   // Extract zip code if present
//   const zipCodeMatch = address.match(/\b(\d{4})\b/);
//   if (zipCodeMatch) {
//     zipCode = zipCodeMatch[1];
//   }

//   // Try to extract city with more patterns
//   const cityPatterns = [
//     /(?:in|at|,)\s+([A-Za-z\s]+City|[A-Za-z\s]+Municipality)/i, // "in Manila City" or "at Quezon City"
//     /\b((?:Makati|Manila|Quezon|Taguig|Pasig|Pasay|Parañaque|Mandaluyong|Marikina|Caloocan|Valenzuela|Malabon|Navotas|Muntinlupa|Las Piñas|San Juan|Pateros)(?:\s+City)?)\b/i, // Common Metro Manila cities
//     /\b([A-Za-z]+(?:\s+[A-Za-z]+)?)\s*,\s*(?:Metro\s+Manila|NCR|[A-Za-z\s]+\b(?:Province|Islands))\b/i, // "City, Province" pattern
//     /\b([A-Za-z]+(?:\s+[A-Za-z]+)?)(?=\s*,\s*\d{4})/i, // City followed by comma and zip code
//   ];

//   // Try each pattern until we find a match
//   for (const pattern of cityPatterns) {
//     const cityMatch = address.match(pattern);
//     if (cityMatch) {
//       city = cityMatch[1].trim();
//       break;
//     }
//   }

//   // Try to extract barangay
//   const barangayPatterns = [
//     /(?:Brgy\.|Barangay|Bgy\.)\s+([A-Za-z0-9\s]+)(?:,|$)/i,
//     /\bin\s+([A-Za-z0-9\s]+)\s+(?:barangay|brgy)/i,
//   ];

//   for (const pattern of barangayPatterns) {
//     const barangayMatch = address.match(pattern);
//     if (barangayMatch) {
//       barangay = barangayMatch[1].trim();
//       break;
//     }
//   }

//   // Update session with parsed address
//   await MessengerReportSession.findOneAndUpdate(
//     { psid },
//     {
//       "data.location.address.streetAddress": streetAddress,
//       "data.location.address.barangay": barangay,
//       "data.location.address.city": city,
//       "data.location.address.zipCode": zipCode,
//       currentStep: "PHOTO",
//     },
//     { new: true }
//   );

//   // Store raw address for direct geocoding
//   await MessengerReportSession.findOneAndUpdate({ psid }, { "data.location.rawAddress": address });

//   // Try to geocode the address immediately with multiple approaches
//   try {
//     // First try with parsed fields
//     const addressObj = {
//       streetAddress,
//       barangay,
//       city,
//       zipCode,
//     };

//     let geoData = await getCoordinatesFromAddress(addressObj);
//     console.log("Geocoding result (structured):", geoData);

//     // If that fails, try with the raw address
//     if (!geoData.success) {
//       geoData = await getCoordinatesFromAddress({ fullAddress: address });
//       console.log("Geocoding result (raw):", geoData);
//     }

//     // If successful, store coordinates
//     if (geoData.success) {
//       await MessengerReportSession.findOneAndUpdate({ psid }, { "data.location.coordinates": geoData.coordinates });
//     }
//   } catch (error) {
//     console.error("Error geocoding address:", error);
//     // Continue without coordinates, we'll try again at submission
//   }

//   // Ask for photo with example guidance
//   await sendResponse(psid, {
//     text: "Please upload a recent photo of the person:",
//   });
// }

// async function handlePhotoInput(psid, message, session) {
//   try {
//     // Check if message contains an image attachment
//     if (message.attachments && message.attachments[0] && message.attachments[0].type === "image") {
//       const photoUrl = message.attachments[0].payload.url;

//       // Process photo right away to avoid issues later
//       const photoResult = await processMessengerPhoto(photoUrl, psid);

//       if (!photoResult) {
//         return await sendResponse(psid, {
//           text: "We had trouble processing your photo. Please try uploading it again.",
//         });
//       }

//       // Update session with processed image info
//       await MessengerReportSession.findOneAndUpdate(
//         { psid },
//         {
//           "data.photo": {
//             url: photoResult.url,
//             public_id: photoResult.public_id,
//           },
//           currentStep: "CREDENTIAL",
//         },
//         { new: true }
//       );

//       // Ask for ID verification
//       await sendResponse(psid, {
//         text: "Please provide a full name, valid ID or any credentials for verification (ID type and ID number):",
//       });
//     } else {
//       await sendResponse(psid, {
//         text: "Please upload a photo of the person (tap the + button and select Gallery):",
//       });
//     }
//   } catch (error) {
//     console.error("Error processing photo:", error);
//     await sendResponse(psid, {
//       text: "We encountered an error while processing your photo. Please try again.",
//     });
//   }
// }

// async function handleCredentialInput(psid, text, session) {
//   // Check if text exists before trying to use trim()
//   if (!text) {
//     return await sendResponse(psid, {
//       text: "Please provide your credentials as text (not an image or attachment):",
//     });
//   }

//   if (text.trim().length < 5) {
//     return await sendResponse(psid, {
//       text: "Please provide more detailed credentials for verification:",
//     });
//   }

//   // Store the credentials
//   await MessengerReportSession.findOneAndUpdate(
//     { psid },
//     {
//       "data.credential": text.trim(),
//       currentStep: "CONFIRM",
//     },
//     { new: true }
//   );

//   // Get updated session
//   const updatedSession = await MessengerReportSession.findOne({ psid });
//   const reportData = updatedSession.data;

//   // Show confirmation with summary
//   await sendResponse(psid, {
//     attachment: {
//       type: "template",
//       payload: {
//         template_type: "generic",
//         elements: [
//           {
//             title: "Report Preview",
//             subtitle: `Type: ${reportData.type}\nName: ${reportData.personInvolved.firstName} ${reportData.personInvolved.lastName}\nLocation: ${reportData.location.address.city}`,
//             image_url: reportData.photo.url,
//             buttons: [
//               {
//                 type: "postback",
//                 title: "Submit Report",
//                 payload: "SUBMIT_REPORT",
//               },
//               {
//                 type: "postback",
//                 title: "Cancel",
//                 payload: "CANCEL_REPORT",
//               },
//             ],
//           },
//         ],
//       },
//     },
//   });
// }

// /**
//  * Process and upload photo from Messenger to Cloudinary
//  * @param {string} photoUrl - URL of the photo from Messenger
//  * @param {string} psid - Sender's PSID for naming the temp file
//  * @returns {Promise<Object|null>} - Cloudinary upload result or null if failed
//  */
// async function processMessengerPhoto(photoUrl, psid) {
//   try {
//     // Download image from Facebook
//     const response = await axios.get(photoUrl, {
//       responseType: "arraybuffer",
//       timeout: 10000, // 10 second timeout
//     });

//     const buffer = Buffer.from(response.data, "binary");

//     // Validate image size (10MB max)
//     if (buffer.length > 10 * 1024 * 1024) {
//       console.error("Image too large:", buffer.length / (1024 * 1024), "MB");
//       return null;
//     }

//     // Create temp directory if it doesn't exist
//     const tempDir = path.join(__dirname, "../uploads");
//     if (!fs.existsSync(tempDir)) {
//       fs.mkdirSync(tempDir, { recursive: true });
//     }

//     const tempFilePath = path.join(tempDir, `messenger_${psid}_${Date.now()}.jpg`);
//     fs.writeFileSync(tempFilePath, buffer);

//     // Upload to Cloudinary with optimization options
//     const photoResult = await uploadToCloudinary(tempFilePath, "messenger_reports", "image");

//     // Clean up temp files
//     if (fs.existsSync(tempFilePath)) {
//       try {
//         fs.unlinkSync(tempFilePath);
//         console.log(`Successfully deleted temporary file: ${tempFilePath}`);
//       } catch (unlinkError) {
//         console.warn(`Warning: Could not delete temporary file ${tempFilePath}:`, unlinkError);
//       }
//     }

//     return photoResult;
//   } catch (error) {
//     console.error("Error processing messenger photo:", error);
//     return null;
//   }
// }

// // UPDATED: Modified submitReport function to handle coordinates better and ensure reporter info
// async function submitReport(psid) {
//   try {
//     // Find session
//     const session = await MessengerReportSession.findOne({ psid });
//     if (!session) {
//       return await sendResponse(psid, { text: "Your report session has expired. Please start again." });
//     }

//     console.log("Found session:", session._id);

//     // Get session data
//     const reportData = session.data;
//     console.log("Report data:", JSON.stringify(reportData, null, 2));

//     // Check if we have photo data
//     if (!reportData.photo || !reportData.photo.url) {
//       return await sendResponse(psid, {
//         text: "Missing photo information. Please restart the report process and upload a photo.",
//       });
//     }

//     // Get coordinates
//    // Get coordinates
// const location = {
//   address: {
//     streetAddress: reportData.location.address.streetAddress || "Unknown",
//     barangay: reportData.location.address.barangay || "Unknown",
//     city: reportData.location.address.city || "Unknown",
//     zipCode: reportData.location.address.zipCode || "Unknown"
//   },
//   rawAddress: reportData.location.rawAddress || reportData.location.address.streetAddress
// };

// // Try to use coordinates from session first
// let coordinates = reportData.location.coordinates;

// // If no valid coordinates in session, try geocoding again with multiple approaches
// if (!coordinates || !Array.isArray(coordinates) || coordinates.length !== 2 || 
//     (coordinates[0] === 0 && coordinates[1] === 0)) {
  
//   console.log("No valid coordinates in session, attempting geocoding...");
  
//   // Try with raw address first
//   let geoData = null;
//   if (location.rawAddress) {
//     geoData = await getCoordinatesFromAddress({ fullAddress: location.rawAddress });
//     console.log("Geocoding result (raw):", geoData);
//   }
  
//   // If that fails, try with structured fields
//   if (!geoData || !geoData.success) {
//     geoData = await getCoordinatesFromAddress(location.address);
//     console.log("Geocoding result (structured):", geoData);
//   }
  
//   if (geoData && geoData.success) {
//     coordinates = geoData.coordinates;
    
//     // Verify coordinates are in Philippines (rough bounding box)
//     const isInPhilippines = 
//       coordinates[0] >= 114 && coordinates[0] <= 127 && // Longitude
//       coordinates[1] >= 4 && coordinates[1] <= 21;      // Latitude
      
//     if (!isInPhilippines) {
//       console.log("Warning: Coordinates appear to be outside Philippines:", coordinates);
//       // Use default coordinates for Metro Manila
//       coordinates = [121.0244, 14.5547];
//       await sendResponse(psid, { 
//         text: "We couldn't determine a valid location in the Philippines. Using Metro Manila as default location."
//       });
//     }
//   } else {
//     // Use default coordinates (Metro Manila) if geocoding fails
//     coordinates = [121.0244, 14.5547]; // Metro Manila
//     await sendResponse(psid, { 
//       text: "We couldn't process your location precisely. We'll use Metro Manila as the approximate location, but please update your report in the app later."
//     });
//   }
// }

//     // Find or create user for this PSID
//     let user = await User.findOne({ messengerPSID: psid });

//     // If somehow we still don't have a user, create one now
//     if (!user) {
//       user = await User.create({
//         messengerPSID: psid,
//         role: "citizen",
//         name: "Messenger User",
//         email: `messenger_${psid}@temp.agapayalert.com`,
//         validIdSubmitted: false,
//         status: "active",
//       });
//     }

//     // Find police station
//     const assignedStation = await findPoliceStation(null, coordinates, true);

//     if (!assignedStation) {
//       return await sendResponse(psid, {
//         text: "We couldn't find a police station to assign. Please try submitting your report through the AgapayAlert app.",
//       });
//     }

//     console.log("Assigned station:", assignedStation._id);

//     // Create report always with reporter
//     const report = new Report({
//       reporter: user._id, // Always assign a reporter
//       type: reportData.type,
//       personInvolved: {
//         firstName: reportData.personInvolved.firstName,
//         lastName: reportData.personInvolved.lastName,
//         age: reportData.personInvolved.age,
//         // Required fields with default values
//         dateOfBirth: new Date(Date.now() - reportData.personInvolved.age * 365 * 24 * 60 * 60 * 1000), // Approximate from age
//         lastSeenDate: new Date(),
//         lastSeentime: new Date().toTimeString().substring(0, 5),
//         lastKnownLocation: reportData.location.address.streetAddress,
//         relationship: "Not specified via messenger",
//         gender: "Unknown", // Required field
//         mostRecentPhoto: {
//           url: reportData.photo.url,
//           public_id: reportData.photo.public_id,
//         },
//       },
//       location: {
//         type: "Point",
//         coordinates: coordinates,
//         address: location.address,
//       },
//       assignedPoliceStation: assignedStation._id,
//       broadcastConsent: true,
//       reportSource: "messenger",
//       validIdSubmitted: true, // Mark as having valid ID since we collected credential info
//       credential: reportData.credential || "Verified via Messenger", // Store the credential information
//       consentUpdateHistory: [
//         {
//           previousValue: false,
//           newValue: true,
//           updatedBy: user._id,
//           date: new Date(),
//         },
//       ],
//     });

//     console.log("About to save report with data:", {
//       type: report.type,
//       reporter: report.reporter,
//       firstName: report.personInvolved.firstName,
//       lastName: report.personInvolved.lastName,
//       coordinates: report.location.coordinates,
//       photoUrl: report.personInvolved.mostRecentPhoto.url,
//     });

//     // Save with explicit error handling
//     try {
//       const savedReport = await report.save();
//       console.log("Report saved successfully:", savedReport._id);

//       // Generate case ID automatically if not already set
//       if (!savedReport.caseId) {
//         const prefix = savedReport.type.substring(0, 3).toUpperCase();
//         const idSuffix = savedReport._id.toString().slice(-7);
//         savedReport.caseId = `${prefix}-${idSuffix}`;
//         await savedReport.save();
//       }

//       // Delete session only after successful save
//       await session.deleteOne();

//       await sendResponse(psid, {
//         text: `Thank you. Your report has been submitted successfully!\n\nCase ID: ${savedReport.caseId}\n\nIt has been assigned to ${assignedStation.name}.\n\nYou can view and update this report in the AgapayAlert app.`,
//       });
//     } catch (saveError) {
//       console.error("Error saving report:", saveError);

//       // Check for validation errors
//       if (saveError.name === "ValidationError") {
//         console.error("Validation errors:", saveError.errors);

//         const errorMessages = Object.keys(saveError.errors)
//           .map((field) => `${field}: ${saveError.errors[field].message}`)
//           .join("\n");

//         await sendResponse(psid, {
//           text: `We encountered validation errors while creating your report:\n\n${errorMessages}\n\nPlease try again or use the AgapayAlert app.`,
//         });
//       } else {
//         await sendResponse(psid, {
//           text: "We encountered an error while saving your report. Please try again or use the AgapayAlert app.",
//         });
//       }
//     }
//   } catch (error) {
//     console.error("Error in submitReport:", error);
//     await sendResponse(psid, {
//       text: "We encountered an error while submitting your report. Please try again or use the AgapayAlert app.",
//     });
//   }
// }

// async function cancelReport(psid) {
//   // Delete the session
//   await MessengerReportSession.deleteOne({ psid });

//   // Confirm cancellation
//   await sendResponse(psid, {
//     text: "Your report has been cancelled. How else can I help you?",
//   });

//   // Send report menu again
//   await sendReportMenu(psid);
// }

// async function sendReportMenu(psid) {
//   await sendResponse(psid, {
//     attachment: {
//       type: "template",
//       payload: {
//         template_type: "button",
//         text: "What would you like to do?",
//         buttons: [
//           {
//             type: "postback",
//             title: "Create Report",
//             payload: "CREATE_REPORT",
//           },
//           {
//             type: "postback",
//             title: "About Us",
//             payload: "ABOUT_US",
//           },
//           {
//             type: "web_url",
//             url: "https://agapayalert-web.onrender.com/",
//             title: "Visit Website",
//           },
//         ],
//       },
//     },
//   });
// }

// async function sendResponse(sender_psid, response) {
//   try {
//     await axios.post(
//       `${FB_API_BASE}/me/messages`,
//       {
//         recipient: { id: sender_psid },
//         message: response,
//         messaging_type: "RESPONSE",
//       },
//       {
//         headers: { "Content-Type": "application/json" },
//         params: { access_token: process.env.FACEBOOK_PAGE_ACCESS_TOKEN },
//       }
//     );
//     console.log("✅ Message sent to:", sender_psid);
//   } catch (error) {
//     console.error("❌ Error sending message:", error.response?.data || error);
//     throw error;
//   }
// }

// // Validate report data
// async function validateReportData(reportData) {
//   // Check minimal required fields
//   const requiredFields = [
//     "type",
//     "personInvolved.firstName",
//     "personInvolved.lastName",
//     "personInvolved.mostRecentPhoto.url",
//     "personInvolved.mostRecentPhoto.public_id",
//     "location.coordinates",
//     "location.address.streetAddress",
//     "location.address.barangay",
//     "location.address.city",
//     "location.address.zipCode",
//     "assignedPoliceStation",
//     "reporter", // We require a reporter
//   ];

//   const missingFields = [];

//   // Helper function to check nested fields
//   function checkNestedField(obj, fieldPath) {
//     const parts = fieldPath.split(".");
//     let current = obj;

//     for (const part of parts) {
//       if (current === undefined || current === null || !current.hasOwnProperty(part)) {
//         return false;
//       }
//       current = current[part];
//     }

//     return current !== undefined && current !== null && current !== "";
//   }

//   for (const field of requiredFields) {
//     if (!checkNestedField(reportData, field)) {
//       missingFields.push(field);
//     }
//   }

//   return {
//     isValid: missingFields.length === 0,
//     missingFields,
//   };
// }

// exports.sendCustomMessage = async (psid, message) => {
//   return await sendResponse(psid, { text: message });
// };

// // Export everything properly
// module.exports = {
//   initializeMessenger: exports.initializeMessenger,
//   handleMessage: exports.handleMessage,
//   handlePostback: exports.handlePostback,
//   sendCustomMessage: exports.sendCustomMessage,
// };
