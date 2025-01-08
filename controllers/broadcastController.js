const Report = require('../models/reportModel');
const asyncHandler = require('express-async-handler');
const statusCodes = require('../constants/statusCodes');
const { sendOneSignalNotification, sendEmailNotification } = require('../utils/notificationUtils');
const { createFacebookPost } = require('../utils/broadcastUtils');

exports.publishReport = asyncHandler(async (req, res) => {
  try {
    const { reportId } = req.params;
    const { channels = [], scheduledDate } = req.body;

    // Validate channels
    const validChannels = ['push', 'email', 'facebook'];
    const selectedChannels = channels.filter(channel => validChannels.includes(channel));

    if (selectedChannels.length === 0) {
      return res.status(statusCodes.BAD_REQUEST).json({
        success: false,
        msg: 'At least one valid channel must be selected'
      });
    }

    const report = await Report.findById(reportId);

    if (!report) {
      return res.status(statusCodes.NOT_FOUND).json({
        success: false,
        msg: 'Report not found'
      });
    }

    if (!report.broadcastConsent) {
      return res.status(statusCodes.BAD_REQUEST).json({
        success: false,
        msg: 'No broadcast consent given for this report'
      });
    }

    // Handle scheduling
    if (scheduledDate) {
      report.publishSchedule = {
        scheduledDate: new Date(scheduledDate),
        channels: selectedChannels
      };
      report.save();

      return res.status(statusCodes.OK).json({
        success: true,
        msg: 'Broadcast scheduled successfully',
        scheduledDate: report.publishSchedule.scheduledDate
      });
    }

    // Immediate publishing
    report.isPublished = true;
    const broadcastRecord = {
      date: new Date(),
      action: 'published',
      method: selectedChannels,
      publishedBy: req.user.id
    };

    // Execute broadcasts
    const broadcastPromises = [];
    
    if (selectedChannels.includes('push')) {
      broadcastPromises.push(sendOneSignalNotification({
        message: `New ${report.type} Alert: Please help locate ${report.personInvolved.firstName} ${report.personInvolved.lastName}`,
        data: { reportId: report._id }
      }));
    }

    if (selectedChannels.includes('email')) {
      broadcastPromises.push(sendEmailNotification(
        'broadcastReport.ejs',
        {
          reportId: report._id,
          reportType: report.type,
          personName: `${report.personInvolved.firstName} ${report.personInvolved.lastName}`,
          lastSeen: report.personInvolved.lastSeenDate,
          location: report.location.address
        }
      ));
    }

    if (selectedChannels.includes('facebook')) {
      broadcastPromises.push(createFacebookPost(report));
    }

    await Promise.all(broadcastPromises);
    report.broadcastHistory.push(broadcastRecord);
    await report.save();

    res.status(statusCodes.OK).json({
      success: true,
      msg: 'Report published successfully',
      channels: selectedChannels
    });

  } catch (error) {
    console.error('Broadcasting error:', error);
    res.status(statusCodes.INTERNAL_SERVER_ERROR).json({
      success: false,
      msg: 'Error broadcasting report',
      error: error.message
    });
  }
});