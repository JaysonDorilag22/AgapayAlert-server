const oneSignalClient = require('../config/oneSignalConfig');
const transporter = require('../config/mailtrapConfig');
const User = require('../models/userModel');
const ejs = require('ejs');
const path = require('path');
const roles = require('../constants/roles');
const dotenv = require('dotenv');

dotenv.config();

const sendOneSignalNotification = async (message) => {
  console.log('Preparing OneSignal notification:', { message });

  const notification = {
    app_id: process.env.ONESIGNAL_APP_ID,
    included_segments: ["All"],
    contents: { en: message },
    headings: { en: "AgapayAlert Notification" }
  };

  try {
    console.log('Sending OneSignal request:', notification);
    const response = await oneSignalClient.post('/notifications', notification);
    console.log('OneSignal success:', response.data);
    return { success: true, data: response.data };
  } catch (error) {
    console.error('OneSignal failed:', error.response?.data || error);
    return { success: false, error: error.message };
  }
};

const sendEmailNotification = async (template, context, recipients) => {
  try {
    const templatePath = path.join(__dirname, '..', 'views', template);
    const html = await ejs.renderFile(templatePath, {
      reportId: context.reportId || 'N/A',
      reportType: context.reportType || 'N/A',
      personName: context.personName || 'N/A',
      lastSeenDate: context.lastSeenDate ? new Date(context.lastSeenDate).toLocaleDateString() : 'N/A',
      lastKnownLocation: context.lastKnownLocation || 'N/A',
      reportAddress: context.reportAddress || 'N/A'
    });

    const mailOptions = {
      from: process.env.SMTP_FROM_EMAIL,
      to: recipients,
      subject: `New ${context.reportType} Report Assigned`,
      html: html,
    };

    const result = await transporter.sendMail(mailOptions);
    console.log('Email sent:', { recipients, messageId: result.messageId });
    return { success: true };
  } catch (error) {
    console.error('Email failed:', error);
    return { success: false, error: error.message };
  }
};

const notifyPoliceStation = async (report, nearestStation) => {
  let notificationResults = { oneSignal: false, email: false };

  try {
    // Get station personnel
    const [officers, admin] = await Promise.all([
      User.find({ 
        policeStation: nearestStation._id, 
        roles: roles.POLICE_OFFICER.role 
      }),
      User.findOne({ 
        policeStation: nearestStation._id, 
        roles: roles.POLICE_ADMIN.role 
      })
    ]);

    console.log('Found recipients:', {
      officersCount: officers.length,
      hasAdmin: !!admin
    });

    if (!admin) {
      console.warn('No admin found for station:', nearestStation._id);
    }

    // Prepare notification message
    const notificationMessage = `New ${report.type} Report: ${report.personInvolved.firstName} ${report.personInvolved.lastName} was reported ${report.type.toLowerCase()} at ${report.location.address.barangay}, ${report.location.address.city}`;

    // Send OneSignal notification
    const oneSignalResult = await sendOneSignalNotification(notificationMessage);
    notificationResults.oneSignal = oneSignalResult.success;

    // Send email notifications
    const emailRecipients = officers.map(o => o.email);
    if (admin) emailRecipients.push(admin.email);

    if (emailRecipients.length > 0) {
      const emailContext = {
        reportId: report._id,
        reportType: report.type,
        personName: `${report.personInvolved.firstName} ${report.personInvolved.lastName}`,
        lastSeenDate: report.personInvolved.lastSeenDate,
        lastKnownLocation: report.personInvolved.lastKnownLocation,
        reportAddress: `${report.location.address.streetAddress}, ${report.location.address.barangay}, ${report.location.address.city}`
      };

      const emailResult = await sendEmailNotification(
        'newReportNotificationEmail.ejs', 
        emailContext, 
        emailRecipients
      );
      notificationResults.email = emailResult.success;
    }

    console.log('Notification results:', notificationResults);
    return notificationResults;

  } catch (error) {
    console.error('Notification error:', error);
    return notificationResults;
  }
};

module.exports = {
  sendOneSignalNotification,
  sendEmailNotification,
  notifyPoliceStation
};