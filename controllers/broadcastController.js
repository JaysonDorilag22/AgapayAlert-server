const Report = require('../models/reportModel');
const User = require('../models/userModel');
const asyncHandler = require('express-async-handler');
const statusCodes = require('../constants/statusCodes');
const errorMessages = require('../constants/errorMessages');
const { sendEmailNotification } = require('../utils/notificationUtils');
const { sendPushNotification, createFacebookPost } = require('../utils/broadcastUtils');

// Broadcast a report
exports.broadcastReport = asyncHandler(async (req, res) => {
  const { reportId } = req.params;
  const { consent, location } = req.body;

  const report = await Report.findById(reportId);

  if (!report) {
    return res.status(statusCodes.NOT_FOUND).json({ msg: errorMessages.REPORT_NOT_FOUND });
  }

  if (consent) {
    report.broadcastConsent = true;
    await report.save();

    let users;
    if (location) {
      users = await User.find({ 'address.city': location });
    } else {
      users = await User.find({});
    }

    const emailRecipients = users.map(user => user.email);
    const pushRecipients = users.map(user => user.oneSignalPlayerId).filter(id => id);

    // Send push notifications
    if (pushRecipients.length > 0) {
      await sendPushNotification(`Report ${report._id} is now public`, pushRecipients);
      report.broadcastHistory.push({ method: 'Push Notification' });
    }

    // Create Facebook post
    await createFacebookPost(report);
    report.broadcastHistory.push({ method: 'Facebook Post' });

    // Send email notifications
    const emailContext = {
      reportId: report._id,
      reportType: report.type,
      reportSubject: report.details.subject,
      reportDescription: report.details.description,
      mostRecentPhoto: report.personInvolved.mostRecentPhoto.url,
    };
    await sendEmailNotification('broadcastReport.ejs', emailContext, emailRecipients);
    report.broadcastHistory.push({ method: 'Email' });

    await report.save();
  }

  res.status(statusCodes.OK).json(report);
});