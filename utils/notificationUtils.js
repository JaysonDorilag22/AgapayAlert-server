const oneSignalClient = require('../config/oneSignalConfig');
const transporter = require('../config/mailtrapConfig');
const User = require('../models/userModel');
const ejs = require('ejs');
const path = require('path');
const roles = require('../constants/roles');
const dotenv = require('dotenv');

dotenv.config();

const sendOneSignalNotification = async (notificationData) => {
  try {
    const notification = {
      app_id: process.env.ONESIGNAL_APP_ID,
      include_player_ids: notificationData.include_player_ids,
      contents: { 
        en: notificationData.message 
      },
      headings: { en: "AgapayAlert Notification" },
      data: notificationData.data
    };

    const response = await oneSignalClient.post('/notifications', notification);
    return { success: true, data: response.data };
  } catch (error) {
    console.error('OneSignal failed:', error.response?.data || error);
    return { success: false, error: error.message };
  }
};

const sendEmailNotification = async (template, context, recipients) => {
  try {
    const templatePath = path.join(__dirname, '..', 'views', template);
    const html = await ejs.renderFile(templatePath, context);

    const mailOptions = {
      from: process.env.SMTP_FROM_EMAIL,
      to: recipients,
      subject: template.includes('finder') ? 
        `New Finder Report Alert - ${context.reportType} Case` : 
        `New ${context.reportType} Report Alert`,
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
    // Get only relevant station personnel
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

    // Get device IDs for OneSignal notification
    const deviceIds = [
      ...officers.map(o => o.deviceToken).filter(Boolean),
      admin?.deviceToken
    ].filter(Boolean);

    // Prepare notification message
    const notificationMessage = `New ${report.type} Report: ${report.personInvolved.firstName} ${report.personInvolved.lastName} was reported ${report.type.toLowerCase()} at ${report.location.address.barangay}, ${report.location.address.city}`;

    // Send targeted OneSignal notification
    if (deviceIds.length > 0) {
      const oneSignalResult = await sendOneSignalNotification({
        message: notificationMessage,
        // Target specific devices instead of all users
        include_player_ids: deviceIds,
        data: {
          reportId: report._id,
          type: 'NEW_REPORT',
          stationId: nearestStation._id
        }
      });
      notificationResults.oneSignal = oneSignalResult.success;
    }

    // Send email notifications only to station personnel
    const emailRecipients = [
      ...officers.map(o => o.email),
      admin?.email
    ].filter(Boolean);

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

    // Create in-app notifications for relevant users
    const notificationPromises = [
      ...officers,
      admin
    ].filter(Boolean).map(user => 
      Notification.create({
        recipient: user._id,
        type: 'NEW_REPORT',
        title: 'New Report Assigned',
        message: notificationMessage,
        data: {
          reportId: report._id,
          type: report.type,
          status: report.status
        }
      })
    );

    await Promise.all(notificationPromises);

    console.log('Notification results:', notificationResults);
    return notificationResults;

  } catch (error) {
    console.error('Notification error:', error);
    return notificationResults;
  }
};

const notifyFinderReport = async (finderReport, originalReport, assignedStation, notificationData) => {
  let notificationResults = { oneSignal: false, email: false };

  try {
    console.log('Finder Report Data:', {
      dateAndTime: finderReport.discoveryDetails.dateAndTime,
      location: finderReport.discoveryDetails.location,
      personCondition: finderReport.personCondition,
      images: finderReport.images
    });

    console.log('Original Report Data:', {
      type: originalReport.type,
      person: originalReport.personInvolved
    });

    console.log('Notification Data:', notificationData);

    const [officers, admin] = await Promise.all([
      User.find({ 
        policeStation: assignedStation._id, 
        roles: roles.POLICE_OFFICER.role 
      }),
      User.findOne({ 
        policeStation: assignedStation._id, 
        roles: roles.POLICE_ADMIN.role 
      })
    ]);

    // Send OneSignal notification
    const oneSignalResult = await sendOneSignalNotification({
      message: notificationData.message,
      data: notificationData.data
    });
    notificationResults.oneSignal = oneSignalResult.success;

    // Send email notifications
    const emailRecipients = officers.map(o => o.email);
    if (admin) emailRecipients.push(admin.email);

    if (emailRecipients.length > 0) {
      // Map data with proper checks
      const emailContext = {
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
      };

      console.log('Email Context Before Sending:', emailContext);

      const emailResult = await sendEmailNotification(
        'finderReportNotificationEmail.ejs',
        emailContext,
        emailRecipients
      );
      notificationResults.email = emailResult.success;
    }

    return notificationResults;
  } catch (error) {
    console.error('Finder Report Notification error:', error);
    return notificationResults;
  }
};

module.exports = {
  sendOneSignalNotification,
  sendEmailNotification,
  notifyPoliceStation,
  notifyFinderReport
};