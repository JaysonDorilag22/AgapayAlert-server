const FinderReport = require('../models/FinderReportModel');
const Report = require('../models/reportModel');
const asyncHandler = require('express-async-handler');
const statusCodes = require('../constants/statusCodes');
const { getCoordinatesFromAddress } = require('../utils/geocoding');
const uploadToCloudinary = require('../utils/uploadToCloudinary');
const { sendEmailNotification, notifyFinderReport } = require('../utils/notificationUtils');

// Create finder report with images and notify police station
exports.createFinderReport = asyncHandler(async (req, res) => {
  try {
    const {
      originalReportId,
      discoveryDetails,
      personCondition,
      authoritiesNotified
    } = req.body;

    // Validate original report
    const originalReport = await Report.findById(originalReportId)
      .populate('assignedPoliceStation');
      
    if (!originalReport) {
      return res.status(statusCodes.NOT_FOUND).json({ msg: 'Original report not found' });
    }

    // Get coordinates and create finder report as before...
    const geoData = await getCoordinatesFromAddress(discoveryDetails.address);
    if (!geoData.success) {
      return res.status(statusCodes.BAD_REQUEST).json({ msg: geoData.message });
    }

    let images = [];
    if (req.files?.images) {
      const uploadPromises = req.files.images.map(file => 
        uploadToCloudinary(file.path, 'finder_reports')
      );
      const uploadResults = await Promise.all(uploadPromises);
      images = uploadResults.map(result => ({
        url: result.url,
        public_id: result.public_id
      }));
    }

    const finderReport = new FinderReport({
      originalReport: originalReportId,
      finder: req.user.id,
      discoveryDetails: {
        ...discoveryDetails,
        location: {
          type: 'Point',
          coordinates: geoData.coordinates,
          address: discoveryDetails.address
        }
      },
      personCondition,
      authoritiesNotified: authoritiesNotified || false,
      images
    });

    await finderReport.save();

    // Notify police station about the finder report
    try {
      const notificationMessage = `New finder report submitted for case: ${originalReport.type} - ${originalReport.personInvolved.firstName} ${originalReport.personInvolved.lastName}`;
      
      await notifyFinderReport(finderReport, originalReport, originalReport.assignedPoliceStation, {
        title: 'New Finder Report',
        message: notificationMessage,
        personCondition: personCondition,
        discoveryLocation: `${discoveryDetails.address.streetAddress}, ${discoveryDetails.address.barangay}, ${discoveryDetails.address.city}`,
        data: {
          finderReportId: finderReport._id,
          originalReportId: originalReport._id,
          discoveryDate: discoveryDetails.dateAndTime
        }
      });

    } catch (notificationError) {
      console.error('Notification failed but finder report was saved:', notificationError);
    }

    res.status(statusCodes.CREATED).json({
      success: true,
      msg: 'Finder report created successfully',
      finderReport
    });

  } catch (error) {
    console.error('Error creating finder report:', error);
    res.status(statusCodes.INTERNAL_SERVER_ERROR).json({
      success: false,
      msg: 'Error creating finder report',
      error: error.message
    });
  }
});

// Get all finder reports with filters and pagination
exports.getFinderReports = asyncHandler(async (req, res) => {
  const { page = 1, limit = 10, status, startDate, endDate } = req.query;
  const query = {};

  if (status) query.status = status;
  if (startDate && endDate) {
    query.createdAt = {
      $gte: new Date(startDate),
      $lte: new Date(endDate)
    };
  }

  const reports = await FinderReport.find(query)
    .populate('finder', '-password')
    .populate('originalReport')
    .populate('verifiedBy', '-password')
    .sort('-createdAt')
    .limit(limit * 1)
    .skip((page - 1) * limit);

  const total = await FinderReport.countDocuments(query);

  res.status(statusCodes.OK).json({
    reports,
    totalPages: Math.ceil(total / limit),
    currentPage: page,
    total
  });
});

// Update finder report
exports.updateFinderReport = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { discoveryDetails, personCondition, authoritiesNotified } = req.body;

  const report = await FinderReport.findById(id);
  if (!report) {
    return res.status(statusCodes.NOT_FOUND).json({ msg: 'Finder report not found' });
  }

  // Only allow updates if status is pending
  if (report.status !== 'Pending') {
    return res.status(statusCodes.BAD_REQUEST).json({
      msg: 'Cannot update verified or false reports'
    });
  }

  // Handle new images
  if (req.files?.images) {
    const uploadPromises = req.files.images.map(file => 
      uploadToCloudinary(file.path, 'finder_reports')
    );
    const uploadResults = await Promise.all(uploadPromises);
    const newImages = uploadResults.map(result => ({
      url: result.url,
      public_id: result.public_id
    }));
    report.images = [...report.images, ...newImages].slice(0, 5); // Keep max 5 images
  }

  Object.assign(report, {
    discoveryDetails,
    personCondition,
    authoritiesNotified
  });

  await report.save();

  res.status(statusCodes.OK).json({
    success: true,
    msg: 'Finder report updated successfully',
    report
  });
});

// Get single finder report
exports.getFinderReportById = asyncHandler(async (req, res) => {
  const report = await FinderReport.findById(req.params.id)
    .populate('finder', '-password')
    .populate('originalReport')
    .populate('verifiedBy', '-password');

  if (!report) {
    return res.status(statusCodes.NOT_FOUND).json({
      msg: 'Finder report not found'
    });
  }

  res.status(statusCodes.OK).json(report);
});

// Verify finder report and notify the finder
exports.verifyFinderReport = asyncHandler(async (req, res) => {
  const { status, verificationNotes } = req.body;
  
  const report = await FinderReport.findById(req.params.id)
    .populate('finder')
    .populate({
      path: 'originalReport',
      populate: {
        path: 'personInvolved'
      }
    });

  if (!report) {
    return res.status(statusCodes.NOT_FOUND).json({
      msg: 'Finder report not found'
    });
  }

  report.status = status;
  report.verifiedBy = req.user.id;
  report.verificationNotes = verificationNotes;
  await report.save();

  // Notify the finder about the verification
  try {
    // Send email notification
    const emailContext = {
      finderReportId: report._id,
      reportType: report.originalReport.type,
      personName: `${report.originalReport.personInvolved.firstName} ${report.originalReport.personInvolved.lastName}`,
      status: status,
      notes: verificationNotes,
      discoveryLocation: `${report.discoveryDetails.location.address.streetAddress}, ${report.discoveryDetails.location.address.barangay}`
    };

    await sendEmailNotification(
      'finderReportVerification.ejs',
      emailContext,
      [report.finder.email]
    );

    console.log('Finder notification sent successfully');
  } catch (notificationError) {
    console.error('Failed to send notification to finder:', notificationError);
  }

  res.status(statusCodes.OK).json({
    msg: 'Finder report verified successfully',
    report
  });
});

exports.getFinderReportsByReportId = asyncHandler(async (req, res) => {
    const { reportId } = req.params;
  
    const originalReport = await Report.findById(reportId);
    if (!originalReport) {
      return res.status(statusCodes.NOT_FOUND).json({
        msg: 'Original report not found'
      });
    }
  
    const finderReports = await FinderReport.find({ originalReport: reportId })
      .populate('finder', '-password')
      .populate('verifiedBy', '-password')
      .sort('-createdAt');
  
    res.status(statusCodes.OK).json({
      count: finderReports.length,
      finderReports
    });
  });

  // Delete finder report
exports.deleteFinderReport = asyncHandler(async (req, res) => {
    const { id } = req.params;
    const report = await FinderReport.findById(id);
  
    if (!report) {
      return res.status(statusCodes.NOT_FOUND).json({
        success: false,
        msg: 'Finder report not found'
      });
    }
  
    // Delete associated images from Cloudinary
    if (report.images?.length > 0) {
      const deletePromises = report.images.map(image => 
        cloudinary.uploader.destroy(image.public_id)
      );
      await Promise.all(deletePromises);
    }
  
    await report.deleteOne();
  
    res.status(statusCodes.OK).json({
      success: true,
      msg: 'Finder report deleted successfully'
    });
  });
  

module.exports = exports;