const axios = require('axios');
const transporter = require('../config/mailtrapConfig');
const User = require('../models/userModel');
const Notification = require('../models/notificationModel');
const ejs = require('ejs');
const path = require('path');
const roles = require('../constants/roles');
const { broadcastTemplates, policeTemplates, userTemplates } = require('./contentTemplates');
const dotenv = require('dotenv');
const NOTIFICATION_SOUNDS = require('../constants/alertSound');
dotenv.config();

const sendOneSignalNotification = async (notificationData, maxRetries = 3) => {
  const validateInput = (data) => {
    if (!data.include_player_ids?.length) {
      throw new Error('No valid device tokens provided');
    }
    if (!data.message) {
      throw new Error('Notification message is required');
    }
  };

  validateInput(notificationData);

  const notification = {
    app_id: process.env.ONESIGNAL_APP_ID,
    include_player_ids: notificationData.include_player_ids,
    contents: { en: notificationData.message },
    headings: { en: notificationData.title || "AgapayAlert" },
    data: notificationData.data,
    ios_sound: "Alert.wav",
    android_sound: "alert",
    priority: 10,
    ttl: 86400
  };

  try {
    const response = await axios.post(
      'https://onesignal.com/api/v1/notifications',
      notification,
      {
        headers: {
          'Authorization': `Basic ${process.env.ONESIGNAL_API_KEY}`,
          'Content-Type': 'application/json'
        },
        timeout: 5000
      }
    );

    return response.data;
  } catch (error) {
    console.error('OneSignal Error:', {
      message: error.message,
      response: error.response?.data,
      payload: notification
    });
    throw error;
  }
};

const sendEmailNotification = async (template, context, recipients) => {
  try {
    const templatePath = path.join(__dirname, '..', 'views', template);
    const html = await ejs.renderFile(templatePath, context);

    const mailOptions = {
      from: process.env.SMTP_FROM_EMAIL,
      to: recipients,
      subject: getEmailSubject(template, context),
      html: html,
    };

    const result = await transporter.sendMail(mailOptions);
    console.log('Email sent:', { recipients, messageId: result.messageId });
    return { success: true, messageId: result.messageId };
  } catch (error) {
    console.error('Email failed:', error);
    return { success: false, error: error.message };
  }
};

const notifyPoliceStation = async (report, nearestStation) => {
  let notificationResults = { oneSignal: false, email: false, inApp: false };

  try {
    const [officers, admin] = await Promise.all([
      User.find({ 
        policeStation: nearestStation._id, 
        roles: roles.POLICE_OFFICER.role,
        deviceToken: { $exists: true, $ne: null }
      }),
      User.findOne({ 
        policeStation: nearestStation._id, 
        roles: roles.POLICE_ADMIN.role,
        deviceToken: { $exists: true, $ne: null }
      })
    ]);

    const deviceIds = [...officers.map(o => o.deviceToken), admin?.deviceToken].filter(Boolean);
    const notificationContent = policeTemplates.newReport(report);

    // Send push notifications
    if (deviceIds.length > 0) {
      const result = await sendOneSignalNotification({
        ...notificationContent,
        include_player_ids: deviceIds,
        image: report.personInvolved.mostRecentPhoto.url
      });
      notificationResults.oneSignal = result.success;
    }

    // Create in-app notifications
    const notificationPromises = [
      ...officers,
      admin
    ].filter(Boolean).map(user => 
      Notification.create({
        recipient: user._id,
        type: 'NEW_REPORT',
        ...notificationContent,
        data: {
          ...notificationContent.data,
          image: report.personInvolved.mostRecentPhoto.url
        }
      })
    );

    await Promise.all(notificationPromises);
    notificationResults.inApp = true;

    return {
      ...notificationResults,
      stats: {
        push: deviceIds.length,
        inApp: notificationPromises.length
      }
    };

  } catch (error) {
    console.error('Police notification error:', error);
    return notificationResults;
  }
};

const notifyFinderReport = async (finderReport, originalReport, assignedStation) => {
  let notificationResults = { oneSignal: false, email: false, inApp: false };

  try {
    const [officers, admin] = await Promise.all([
      User.find({ 
        policeStation: assignedStation._id, 
        roles: roles.POLICE_OFFICER.role,
        deviceToken: { $exists: true, $ne: null }
      }),
      User.findOne({ 
        policeStation: assignedStation._id, 
        roles: roles.POLICE_ADMIN.role,
        deviceToken: { $exists: true, $ne: null }
      })
    ]);

    const notificationContent = policeTemplates.finderReport(finderReport, originalReport);
    const deviceIds = [...officers.map(o => o.deviceToken), admin?.deviceToken].filter(Boolean);

    // Send push notifications
    if (deviceIds.length > 0) {
      const result = await sendOneSignalNotification({
        ...notificationContent,
        include_player_ids: deviceIds,
        image: finderReport.images?.[0]?.url
      });
      notificationResults.oneSignal = result.success;
    }

    // Send email notifications
    const emailRecipients = [...officers.map(o => o.email), admin?.email].filter(Boolean);
    if (emailRecipients.length > 0) {
      const emailResult = await sendEmailNotification(
        'finderReportNotificationEmail.ejs',
        getFinderReportEmailContext(finderReport, originalReport),
        emailRecipients
      );
      notificationResults.email = emailResult.success;
    }

    return {
      ...notificationResults,
      stats: {
        push: deviceIds.length,
        email: emailRecipients.length
      }
    };

  } catch (error) {
    console.error('Finder report notification error:', error);
    return notificationResults;
  }
};

// Helper functions
const getEmailSubject = (template, context) => {
  if (template.includes('finder')) {
    return `New Finder Report Alert - ${context.reportType} Case`;
  }
  return `New ${context.reportType} Report Alert`;
};

const getFinderReportEmailContext = (finderReport, originalReport) => ({
  reportType: originalReport.type || 'Not specified',
  personName: `${originalReport.personInvolved.firstName} ${originalReport.personInvolved.lastName}`,
  discoveryDate: finderReport.discoveryDetails.dateAndTime,
  discoveryLocation: finderReport.discoveryDetails.location.address ? 
    `${finderReport.discoveryDetails.location.address.streetAddress}, ${finderReport.discoveryDetails.location.address.barangay}, ${finderReport.discoveryDetails.location.address.city}` : 
    'Not specified',
  personCondition: finderReport.personCondition || {},
  notes: finderReport.personCondition?.notes || '',
  finderReportId: finderReport._id?.toString() || 'Not available',
  originalReportId: originalReport._id?.toString() || 'Not available',
  authoritiesNotified: !!finderReport.authoritiesNotified,
  images: finderReport.images || []
});

const sendSMSNotification = async ({ phones, message }) => {
  try {
    // TODO: Implement SMS provider integration
    // Possible providers:
    // - Twilio
    // - MessageBird
    // - Semaphore
    // - Globe Labs API
    // - Smart DevNet

    console.log('SMS Notification (Not Implemented):', {
      recipients: phones.length,
      message
    });

    // Return mock success for now
    return {
      success: true,
      pending: true,
      provider: 'NOT_IMPLEMENTED',
      stats: {
        total: phones.length,
        sent: 0,
        failed: 0
      },
      message: 'SMS functionality pending provider selection'
    };

  } catch (error) {
    console.error('SMS Notification Error:', error);
    return {
      success: false,
      error: error.message,
      provider: 'NOT_IMPLEMENTED'
    };
  }
};

module.exports = {
  sendOneSignalNotification,
  sendEmailNotification,
  notifyPoliceStation,
  notifyFinderReport,
  sendSMSNotification
};