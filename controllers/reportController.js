const Report = require('../models/reportModel');
const Notification = require('../models/notificationModel');
const User = require('../models/userModel');
const PoliceStation = require('../models/policeStationModel');
const asyncHandler = require('express-async-handler');
const statusCodes = require('../constants/statusCodes');
const errorMessages = require('../constants/errorMessages');
const uploadToCloudinary = require('../utils/uploadToCloudinary');
const { notifyPoliceStation } = require('../utils/notificationUtils');
const cloudinary = require('cloudinary').v2;
const { getCoordinatesFromAddress } = require('../utils/geocoding');

// Helper function to find police station
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
          type: 'Point',
          coordinates
        },
        $maxDistance: 5000
      }
    }
  });

  // If no station within 5km, find absolute nearest
  if (!nearest) {
    return await PoliceStation.findOne({
      location: {
        $near: {
          $geometry: {
            type: 'Point',
            coordinates
          }
        }
      }
    });
  }

  return nearest;
};

// Create a new report
exports.createReport = asyncHandler(async (req, res) => {
  try {
    const { 
      type, 
      personInvolved,
      location,
      selectedPoliceStation,
      broadcastConsent 
    } = req.body;

    // Validate input
    if (!type || !personInvolved || !location) {
      return res.status(statusCodes.BAD_REQUEST).json({
        success: false,
        msg: 'Missing required fields'
      });
    }

    // Get coordinates from address
    const geoData = await getCoordinatesFromAddress(location.address);
    if (!geoData.success) {
      return res.status(statusCodes.BAD_REQUEST).json({
        success: false,
        msg: geoData.message
      });
    }

    // Handle photo upload
    if (!req.files?.['personInvolved[mostRecentPhoto]']) {
      return res.status(statusCodes.BAD_REQUEST).json({
        success: false,
        msg: 'Most recent photo is required'
      });
    }

    const photoFile = req.files['personInvolved[mostRecentPhoto]'][0];
    const photoResult = await uploadToCloudinary(photoFile.path, 'reports');
    
    // Handle additional images
    let additionalImages = [];
    if (req.files?.additionalImages) {
      const uploadPromises = req.files.additionalImages.map(file => 
        uploadToCloudinary(file.path, 'reports')
      );
      const uploadResults = await Promise.all(uploadPromises);
      additionalImages = uploadResults.map(result => ({
        url: result.url,
        public_id: result.public_id
      }));
    }

    // Find police station
    let assignedStation = await findPoliceStation(selectedPoliceStation, geoData.coordinates);
    if (!assignedStation) {
      return res.status(statusCodes.NOT_FOUND).json({
        success: false,
        msg: 'No police stations found in the system'
      });
    }

    // Create report
    const report = new Report({
      reporter: req.user.id,
      type,
      personInvolved: {
        ...personInvolved,
        mostRecentPhoto: {
          url: photoResult.url,
          public_id: photoResult.public_id
        }
      },
      additionalImages,
      location: {
        type: 'Point',
        coordinates: geoData.coordinates,
        address: location.address
      },
      assignedPoliceStation: assignedStation._id,
      broadcastConsent: broadcastConsent || false
    });

    await report.save();

    // Handle notifications
    try {
      // await notifyPoliceStation(report, assignedStation);
      
      // Notify reporter
      await Notification.create({
        recipient: req.user.id,
        type: 'REPORT_CREATED',
        title: 'Report Created',
        message: `Your ${type} report has been created and assigned to ${assignedStation.name}`,
        data: {
          reportId: report._id
        }
      });
    } catch (notificationError) {
      console.error('Notification failed:', notificationError);
    }

    res.status(statusCodes.CREATED).json({
      success: true,
      msg: 'Report created successfully',
      data: {
        report,
        assignedStation,
        assignmentType: selectedPoliceStation ? 'Manual Selection' : 'Automatic Assignment'
      }
    });

  } catch (error) {
    console.error('Error in createReport:', error);
    res.status(statusCodes.INTERNAL_SERVER_ERROR).json({
      success: false,
      msg: 'Error creating report',
      error: error.message
    });
  }
});


// Get Reports (with filters)
exports.getReports = asyncHandler(async (req, res) => {
  try {
    const { status, type, startDate, endDate, page = 1, limit = 10 } = req.query;
    let query = {};

    // Role-based filtering
    switch (req.user.roles[0]) {
      case 'police_officer':
      case 'police_admin':
        // Only see reports assigned to their police station
        if (!req.user.policeStation) {
          return res.status(statusCodes.BAD_REQUEST).json({
            success: false,
            msg: 'Officer/Admin must be assigned to a police station'
          });
        }
        query.assignedPoliceStation = req.user.policeStation;
        break;

      case 'city_admin':
        // Get all stations in the admin's city
        const cityStations = await PoliceStation.find({
          'address.city': req.user.address.city
        });
        query.assignedPoliceStation = {
          $in: cityStations.map(station => station._id)
        };
        break;

      case 'super_admin':
        // Can see all reports
        break;

      default:
        return res.status(statusCodes.FORBIDDEN).json({
          success: false,
          msg: 'Not authorized to view reports'
        });
    }

    // Apply additional filters
    if (status) query.status = status;
    if (type) query.type = type;
    if (startDate && endDate) {
      query.createdAt = {
        $gte: new Date(startDate),
        $lte: new Date(endDate)
      };
    }

    // Get paginated reports
    const reports = await Report.find(query)
      .populate('reporter', '-password')
      .populate('assignedPoliceStation')
      .populate('assignedOfficer', 'firstName lastName number email')
      .sort('-createdAt')
      .skip((page - 1) * limit)
      .limit(limit);

    const total = await Report.countDocuments(query);

    res.status(statusCodes.OK).json({
      success: true,
      data: {
        reports,
        currentPage: page,
        totalPages: Math.ceil(total / limit),
        totalReports: total,
        hasMore: page * limit < total
      }
    });

  } catch (error) {
    console.error('Error getting reports:', error);
    res.status(statusCodes.INTERNAL_SERVER_ERROR).json({
      success: false,
      msg: 'Error retrieving reports',
      error: error.message
    });
  }
});

// Update Report (Police)
exports.updateReport = asyncHandler(async (req, res) => {
  const { reportId } = req.params;
  const { status, followUp } = req.body;
  const isOfficer = req.user.roles.includes('police');

  // Validate officer access
  if (!isOfficer) {
    return res.status(statusCodes.FORBIDDEN).json({
      success: false,
      msg: 'Only police officers can update reports'
    });
  }

  // Validate status if provided
  const validStatuses = ['Pending', 'Assigned', 'Under Investigation', 'Resolved', 'Archived'];
  if (status && !validStatuses.includes(status)) {
    return res.status(statusCodes.BAD_REQUEST).json({
      success: false,
      msg: 'Invalid status value'
    });
  }

  // Get and validate report
  const report = await Report.findById(reportId)
    .populate('reporter', 'deviceToken');
  
  if (!report) {
    return res.status(statusCodes.NOT_FOUND).json({
      success: false,
      msg: errorMessages.REPORT_NOT_FOUND
    });
  }

  // Update status if provided
  if (status) {
    report.statusHistory.push({
      previousStatus: report.status,
      newStatus: status,
      updatedBy: req.user.id,
      updatedAt: new Date()
    });
    report.status = status;
  }

  // Update follow-up if provided
  if (followUp) {
    report.followUp.push({
      details: followUp,
      addedBy: req.user.id,
      addedAt: new Date()
    });
  }

  // Handle additional images
  if (req.files?.additionalImages) {
    const uploadPromises = req.files.additionalImages.map(file => 
      uploadToCloudinary(file.path, 'reports')
    );
    
    try {
      const uploadResults = await Promise.all(uploadPromises);
      const newImages = uploadResults.map(result => ({
        url: result.url,
        public_id: result.public_id,
        uploadedBy: req.user.id,
        uploadedAt: new Date()
      }));
      
      report.additionalImages.push(...newImages);
    } catch (uploadError) {
      console.error('Image upload failed:', uploadError);
      return res.status(statusCodes.BAD_REQUEST).json({
        success: false,
        msg: 'Failed to upload images'
      });
    }
  }

  try {
    await report.save();

    // Create notification for reporter
    const notificationData = {
      recipient: report.reporter._id,
      type: status ? 'STATUS_UPDATED' : 'REPORT_UPDATED',
      title: status ? 'Report Status Updated' : 'Report Updated',
      message: status 
        ? `Your report status has been updated to ${status}`
        : 'Your report has been updated with new information',
      data: {
        reportId: report._id,
        status: status || report.status,
        updatedBy: req.user.id
      }
    };

    await Notification.create(notificationData);

    // Return success response
    res.status(statusCodes.OK).json({
      success: true,
      msg: 'Report updated successfully',
      data: {
        report,
        notification: notificationData
      }
    });

  } catch (error) {
    console.error('Error updating report:', error);
    res.status(statusCodes.INTERNAL_SERVER_ERROR).json({
      success: false,
      msg: 'Failed to update report',
      error: error.message
    });
  }
});

// Delete Report
exports.deleteReport = asyncHandler(async (req, res) => {
  const { reportId } = req.params;
  const isAdmin = req.user.roles.includes('admin');

  if (!isAdmin) {
    return res.status(statusCodes.FORBIDDEN).json({
      msg: 'Only administrators can delete reports'
    });
  }

  const report = await Report.findById(reportId);
  if (!report) {
    return res.status(statusCodes.NOT_FOUND).json({
      msg: errorMessages.REPORT_NOT_FOUND
    });
  }

  // Delete associated images
  if (report.additionalImages?.length) {
    for (const image of report.additionalImages) {
      await cloudinary.uploader.destroy(image.public_id);
    }
  }
  if (report.personInvolved?.mostRecentPhoto?.public_id) {
    await cloudinary.uploader.destroy(report.personInvolved.mostRecentPhoto.public_id);
  }

  await report.deleteOne();
  res.status(statusCodes.OK).json({
    msg: 'Report deleted successfully'
  });
});

// Assign a police station to a report
exports.assignPoliceStation = asyncHandler(async (req, res) => {
  const { reportId, policeStationId } = req.body;
  const isOfficer = req.user.roles.includes('police');

  if (!isOfficer) {
    return res.status(statusCodes.FORBIDDEN).json({
      msg: 'Only police officers can assign police stations'
    });
  }

  const report = await Report.findById(reportId);
  const policeStation = await PoliceStation.findById(policeStationId);

  if (!report) {
    return res.status(statusCodes.NOT_FOUND).json({ 
      msg: errorMessages.REPORT_NOT_FOUND 
    });
  }

  if (!policeStation) {
    return res.status(statusCodes.NOT_FOUND).json({ 
      msg: errorMessages.POLICE_STATION_NOT_FOUND 
    });
  }

  if (report.status !== 'Pending') {
    return res.status(statusCodes.BAD_REQUEST).json({
      msg: 'Can only assign police station to pending reports'
    });
  }

  report.assignedPoliceStation = policeStation._id;
  report.status = 'Assigned';
  await report.save();

  await notifyPoliceStation(report, policeStation);

  res.status(statusCodes.OK).json(report);
});

// Update User Report if the status is pending. Only Consent can be update if the status is in Assigned to Resolved
exports.updateUserReport = asyncHandler(async (req, res) => {
  const { reportId } = req.params;
  const userId = req.user.id;

  const report = await Report.findOne({ _id: reportId, reporter: userId });
  if (!report) {
    return res.status(statusCodes.NOT_FOUND).json({ 
      msg: errorMessages.REPORT_NOT_FOUND 
    });
  }

  if (report.status === 'Pending') {
    const { type, personInvolved, location, dateTime, broadcastConsent } = req.body;
    
    // Handle most recent photo update
    if (req.files?.['personInvolved[mostRecentPhoto]']) {
      if (report.personInvolved?.mostRecentPhoto?.public_id) {
        await cloudinary.uploader.destroy(report.personInvolved.mostRecentPhoto.public_id);
      }

      const photoFile = req.files['personInvolved[mostRecentPhoto]'][0];
      const photoResult = await uploadToCloudinary(photoFile.path, 'reports');
      personInvolved.mostRecentPhoto = {
        url: photoResult.url,
        public_id: photoResult.public_id,
      };
    }

    // Update location coordinates if address changed
    if (location && location.address) {
      const geoData = await getCoordinatesFromAddress(location.address);
      if (!geoData.success) {
        return res.status(statusCodes.BAD_REQUEST).json({
          msg: geoData.message
        });
      }
      location.type = 'Point';
      location.coordinates = geoData.coordinates;
    }

    Object.assign(report, {
      type,
      personInvolved,
      location,
      dateTime,
      broadcastConsent
    });

  } else if (!report.hasUpdatedConsent) {
    if (req.body.broadcastConsent !== undefined) {
      report.consentUpdateHistory.push({
        previousValue: report.broadcastConsent,
        newValue: req.body.broadcastConsent,
      });
      report.broadcastConsent = req.body.broadcastConsent;
      report.hasUpdatedConsent = true;
    } else {
      return res.status(statusCodes.BAD_REQUEST).json({
        msg: 'Only broadcast consent can be updated at this stage'
      });
    }
  } else {
    return res.status(statusCodes.FORBIDDEN).json({
      msg: 'Report cannot be updated at this stage or consent already updated'
    });
  }

  await report.save();
  res.status(statusCodes.OK).json({ 
    msg: 'Report updated successfully',
    report 
  });
});


// Assign an officer to a report
exports.assignOfficer = asyncHandler(async (req, res) => {
  const { reportId, officerId } = req.body;
  const isPoliceAdmin = req.user.roles.includes('police_admin');

  if (!isPoliceAdmin) {
    return res.status(statusCodes.FORBIDDEN).json({
      msg: 'Only police admins can assign officers to reports'
    });
  }

  const report = await Report.findById(reportId)
    .populate('assignedPoliceStation');

  if (!report) {
    return res.status(statusCodes.NOT_FOUND).json({ 
      msg: errorMessages.REPORT_NOT_FOUND 
    });
  }

  // Check if the officer exists and belongs to the same police station
  const officer = await User.findOne({ 
    _id: officerId,
    roles: 'police_officer',
    policeStation: report.assignedPoliceStation._id
  });

  if (!officer) {
    return res.status(statusCodes.NOT_FOUND).json({
      msg: 'Officer not found or does not belong to the assigned police station'
    });
  }

  report.assignedOfficer = officer._id;
  report.status = 'Under Investigation';
  await report.save();

  // Notify the assigned officer
  await notifyPoliceStation(report, report.assignedPoliceStation);

  res.status(statusCodes.OK).json(report);
});


exports.getPublicFeed = asyncHandler(async (req, res) => {
  try {
    const { page = 1, limit = 10, city, type } = req.query;
    const currentPage = parseInt(page);
    const limitPerPage = parseInt(limit);

    // Base query for public reports
    let query = { 
      broadcastConsent: true,
      status: { $ne: 'Resolved' }
    };

    // Add city filter if provided
    if (city) {
      query['location.address.city'] = city;
    }

    // Add type filter if provided and valid
    if (type && ["Missing", "Abducted", "Kidnapped", "Hit-and-Run"].includes(type)) {
      query.type = type;
    }

    const reports = await Report.find(query)
      .select({
        type: 1,
        'personInvolved.firstName': 1,
        'personInvolved.lastName': 1,
        'personInvolved.age': 1,
        'personInvolved.lastSeenDate': 1,
        'personInvolved.lastSeentime': 1,
        'personInvolved.lastKnownLocation': 1,
        'personInvolved.mostRecentPhoto': 1,
        'location.address.city': 1,
        createdAt: 1
      })
      .sort('-createdAt')
      .skip((currentPage - 1) * limitPerPage)
      .limit(limitPerPage);

    const total = await Report.countDocuments(query);

    const feedReports = reports.map(report => ({
      id: report._id,
      type: report.type,
      personName: `${report.personInvolved.firstName} ${report.personInvolved.lastName}`,
      age: report.personInvolved.age,
      lastSeen: {
        date: report.personInvolved.lastSeenDate,
        time: report.personInvolved.lastSeentime
      },
      lastKnownLocation: report.personInvolved.lastKnownLocation,
      city: report.location.address.city,
      photo: report.personInvolved.mostRecentPhoto.url,
      reportedAt: report.createdAt
    }));

    res.status(statusCodes.OK).json({
      success: true,
      data: {
        reports: feedReports,
        currentPage,
        totalPages: Math.ceil(total / limitPerPage),
        totalReports: total,
        hasMore: currentPage * limitPerPage < total
      }
    });

  } catch (error) {
    console.error('Error getting public feed:', error);
    res.status(statusCodes.INTERNAL_SERVER_ERROR).json({
      success: false,
      msg: 'Error retrieving public feed',
      error: error.message
    });
  }
});

// Get distinct cities with active reports that have broadcast consent
exports.getReportCities = asyncHandler(async (req, res) => {
  try {
    const cities = await Report.distinct('location.address.city', {
      broadcastConsent: true,
      status: { $ne: 'Resolved' }
    });

    const sortedCities = cities
      .filter(city => city)
      .sort((a, b) => a.localeCompare(b));

    res.status(statusCodes.OK).json({
      success: true,
      data: {
        cities: sortedCities,
        total: sortedCities.length
      }
    });
  } catch (error) {
    console.error('Error fetching report cities:', error);
    res.status(statusCodes.INTERNAL_SERVER_ERROR).json({
      success: false,
      msg: 'Error retrieving cities',
      error: error.message
    });
  }
});


// Get User's Reports
exports.getUserReports = asyncHandler(async (req, res) => {
  try {
    const { page = 1, limit = 10, status, type } = req.query;
    const currentPage = parseInt(page);
    const limitPerPage = parseInt(limit);

    // Base query - get reports where user is reporter
    let query = { reporter: req.user.id };

    // Add filters if provided
    if (status) query.status = status;
    if (type) query.type = type;

    const reports = await Report.find(query)
      .select({
        type: 1,
        'personInvolved.firstName': 1,
        'personInvolved.lastName': 1,
        'personInvolved.age': 1,
        'personInvolved.lastSeenDate': 1,
        'personInvolved.mostRecentPhoto': 1,
        'location.address': 1,
        status: 1,
        broadcastConsent: 1,
        createdAt: 1
      })
      .populate('assignedPoliceStation', 'name address')
      .sort('-createdAt')
      .skip((currentPage - 1) * limitPerPage)
      .limit(limitPerPage);

    const total = await Report.countDocuments(query);

    res.status(statusCodes.OK).json({
      success: true,
      data: {
        reports,
        currentPage,
        totalPages: Math.ceil(total / limitPerPage),
        totalReports: total,
        hasMore: currentPage * limitPerPage < total
      }
    });

  } catch (error) {
    console.error('Error getting user reports:', error);
    res.status(statusCodes.INTERNAL_SERVER_ERROR).json({
      success: false,
      msg: 'Error retrieving user reports',
      error: error.message
    });
  }
});

// Get User's Report Details
exports.getUserReportDetails = asyncHandler(async (req, res) => {
  try {
    const { reportId } = req.params;
    const userId = req.user.id;

    const report = await Report.findOne({
      _id: reportId,
      reporter: userId
    })
    .populate('assignedPoliceStation', 'name address image')
    .populate('reporter', 'firstName lastName number email')
    .populate('assignedOfficer', 'firstName lastName number email');

    if (!report) {
      return res.status(statusCodes.NOT_FOUND).json({
        success: false,
        msg: errorMessages.REPORT_NOT_FOUND
      });
    }

    res.status(statusCodes.OK).json({
      success: true,
      data: report
    });

  } catch (error) {
    console.error('Error getting report details:', error);
    res.status(statusCodes.INTERNAL_SERVER_ERROR).json({
      success: false,
      msg: 'Error retrieving report details',
      error: error.message
    });
  }
});