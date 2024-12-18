const oneSignalClient = require('../config/oneSignalConfig');
const transporter = require('../config/mailtrapConfig');
const User = require('../models/userModel');
const ejs = require('ejs');
const path = require('path');
const roles = require('../constants/roles');
const dotenv = require('dotenv');

dotenv.config();

/**
 * Send a OneSignal notification.
 * @param {string} message - The notification message.
 * @param {Array<string>} recipients - The OneSignal player IDs of the recipients.
 */
const sendOneSignalNotification = async (message, recipients) => {
  const notification = {
    app_id: process.env.ONESIGNAL_APP_ID,
    include_player_ids: recipients,
    contents: { en: message },
  };

  try {
    const response = await oneSignalClient.createNotification(notification);
    console.log('OneSignal response:', response.data);
  } catch (error) {
    console.error('Error sending OneSignal notification:', error.response ? error.response.data : error.message);
    throw new Error('Failed to send OneSignal notification');
  }
};

/**
 * Send an email notification.
 * @param {string} template - The path to the EJS template.
 * @param {Object} context - The context to pass to the EJS template.
 * @param {Array<string>} recipients - The email addresses of the recipients.
 */
const sendEmailNotification = async (template, context, recipients) => {
  try {
    const templatePath = path.join(__dirname, '..', 'views', template);
    const html = await ejs.renderFile(templatePath, context);

    const mailOptions = {
      from: 'no-reply@yourapp.com',
      to: recipients,
      subject: 'New Report Assigned',
      html: html,
    };

    await transporter.sendMail(mailOptions);
    console.log('Email sent successfully');
  } catch (error) {
    console.error('Error sending email:', error);
    throw new Error('Failed to send email');
  }
};

/**
 * Notify the officers and admin of a police station about a new report.
 * @param {Object} report - The report object.
 * @param {Object} nearestStation - The nearest police station object.
 */
const notifyPoliceStation = async (report, nearestStation) => {
  try {
    const officers = await User.find({ policeStation: nearestStation._id, roles: roles.POLICE_OFFICER.role });
    const admin = await User.findOne({ policeStation: nearestStation._id, roles: roles.POLICE_ADMIN.role });

    console.log('Officers found:', officers);
    console.log('Admin found:', admin);

    if (!admin) {
      console.error('Admin not found for police station:', nearestStation._id);
      throw new Error('Admin not found for police station');
    }

    const notificationMessage = `A new report has been created and assigned to your police station. Report ID: ${report._id}`;

    // Send OneSignal notifications
    const notificationRecipients = officers.map(officer => officer.oneSignalPlayerId).concat(admin.oneSignalPlayerId);
    console.log('Notification recipients:', notificationRecipients);

    if (notificationRecipients.includes(undefined)) {
      console.error('OneSignal player ID is missing for some users. Falling back to email notifications.');
      
      // Send email notifications as a fallback
      const emailRecipients = officers.map(officer => officer.email).concat(admin.email);
      console.log('Email recipients:', emailRecipients);
      const emailContext = {
        reportId: report._id,
        reportType: report.type,
        reportSubject: report.details.subject,
        reportDescription: report.details.description,
      };
      await sendEmailNotification('newReportNotificationEmail.ejs', emailContext, emailRecipients);
    } else {
      try {
        await sendOneSignalNotification(notificationMessage, notificationRecipients);
      } catch (oneSignalError) {
        console.error('OneSignal notification failed:', oneSignalError.response ? oneSignalError.response.data : oneSignalError.message);
        console.log('Attempting to send email notification as a fallback.');

        // Send email notifications as a fallback
        const emailRecipients = officers.map(officer => officer.email).concat(admin.email);
        console.log('Email recipients:', emailRecipients);
        const emailContext = {
          reportId: report._id,
          reportType: report.type,
          reportSubject: report.details.subject,
          reportDescription: report.details.description,
        };
        await sendEmailNotification('newReportNotificationEmail.ejs', emailContext, emailRecipients);
      }
    }
  } catch (error) {
    console.error('Error notifying police station:', error);
    throw new Error('Failed to notify police station');
  }
};

module.exports = {
  sendOneSignalNotification,
  sendEmailNotification,
  notifyPoliceStation,
};