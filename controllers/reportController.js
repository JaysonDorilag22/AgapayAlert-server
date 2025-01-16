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
const {sendOneSignalNotification} = require('../utils/notificationUtils');

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
    } = req.body;

    const broadcastConsent = req.body.broadcastConsent === 'true';

    // Validate input
    if (!type || !personInvolved || !location || typeof broadcastConsent !== 'boolean') {
      return res.status(statusCodes.BAD_REQUEST).json({
        success: false,
        msg: 'Missing required fields or invalid broadcast consent'
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
      broadcastConsent: broadcastConsent,
      consentUpdateHistory: [{
        previousValue: false,
        newValue: broadcastConsent,
        updatedBy: req.user.id,
        date: new Date()
      }]
    });

    await report.save();

    // Handle notifications
    try {
      await notifyPoliceStation(report, assignedStation);
      
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
  try {
    const { reportId } = req.params;
    const { status, followUp } = req.body;
    const userId = req.user.id;

    // Check if user is assigned officer
    const report = await Report.findById(reportId)
      .populate('reporter')
      .populate('assignedPoliceStation')
      .populate('assignedOfficer');

    if (!report) {
      return res.status(statusCodes.NOT_FOUND).json({
        success: false,
        msg: errorMessages.REPORT_NOT_FOUND
      });
    }

    // Verify user is assigned officer
    if (report.assignedOfficer?._id.toString() !== userId) {
      return res.status(statusCodes.FORBIDDEN).json({
        success: false,
        msg: 'Only assigned officers can update this report'
      });
    }

    // Update report
    if (status) report.status = status;
    if (followUp) {
      report.followUp.push({
        note: followUp,
        updatedBy: userId,
        updatedAt: new Date()
      });
    }
    await report.save();

    // Notification promises
    const notificationPromises = [];

    // 1. Notify reporter
    if (report.reporter?.deviceToken) {
      notificationPromises.push(
        // Push notification
        sendOneSignalNotification({
          include_player_ids: [report.reporter.deviceToken],
          headings: { en: 'Report Update' },
          contents: { en: `Your report status has been updated to: ${status}` },
          data: {
            type: 'STATUS_UPDATED',
            reportId: report._id,
            status: status
          }
        }),
        // In-app notification
        Notification.create({
          recipient: report.reporter._id,
          type: 'STATUS_UPDATED',
          title: 'Report Update',
          message: `Your report status has been updated to: ${status}`,
          data: {
            reportId: report._id,
            status: status,
            followUp: followUp ? report.followUp[report.followUp.length - 1] : null
          }
        })
      );
    }

    // 2. Notify police admin
    const policeAdmin = await User.findOne({
      policeStation: report.assignedPoliceStation._id,
      roles: 'police_admin'
    });

    if (policeAdmin?.deviceToken) {
      notificationPromises.push(
        // Push notification
        sendOneSignalNotification({
          include_player_ids: [policeAdmin.deviceToken],
          headings: { en: 'Case Update' },
          contents: { en: `Case ${report._id} has been updated by ${req.user.firstName}` },
          data: {
            type: 'CASE_UPDATED',
            reportId: report._id,
            status: status
          }
        }),
        // In-app notification
        Notification.create({
          recipient: policeAdmin._id,
          type: 'CASE_UPDATED',
          title: 'Case Update',
          message: `Case ${report._id} has been updated by ${req.user.firstName}`,
          data: {
            reportId: report._id,
            status: status,
            followUp: followUp ? report.followUp[report.followUp.length - 1] : null
          }
        })
      );
    }

    // Send all notifications
    await Promise.allSettled(notificationPromises);

    res.status(statusCodes.OK).json({
      success: true,
      msg: 'Report updated successfully',
      data: report
    });

  } catch (error) {
    console.error('Error updating report:', error);
    res.status(statusCodes.INTERNAL_SERVER_ERROR).json({
      success: false,
      msg: 'Error updating report',
      error: error.message
    });
  }
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

  // Get report with populated fields
  const report = await Report.findById(reportId)
    .populate('assignedPoliceStation')
    .populate('reporter')
    .populate('personInvolved');

  if (!report) {
    return res.status(statusCodes.NOT_FOUND).json({ 
      msg: errorMessages.REPORT_NOT_FOUND 
    });
  }

  // Get officer details
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

  // Update report
  report.assignedOfficer = officer._id;
  report.status = 'Under Investigation';
  await report.save();

  // Prepare notification data
  const notificationPromises = [];

  // 1. Officer notifications
  notificationPromises.push(
    // In-app notification
    Notification.create({
      recipient: officer._id,
      type: 'ASSIGNED_OFFICER',
      title: 'New Case Assignment',
      message: `You have been assigned to a ${report.type} case for ${report.personInvolved.firstName} ${report.personInvolved.lastName}`,
      data: {
        reportId: report._id,
        type: report.type,
        reportDetails: {
          location: report.location,
          status: report.status,
          personInvolved: {
            name: `${report.personInvolved.firstName} ${report.personInvolved.lastName}`,
            age: report.personInvolved.age
          }
        }
      }
    })
  );

  // Push notification for officer
  if (officer.deviceToken) {
    notificationPromises.push(
      sendOneSignalNotification({
        include_player_ids: [officer.deviceToken],
        headings: { en: 'New Case Assignment' },
        contents: { en: `You have been assigned to a ${report.type} case` },
        data: {
          type: 'ASSIGNED_OFFICER',
          reportId: report._id,
          caseType: report.type
        }
      })
    );
  }

  // 2. Reporter notifications
  if (report.reporter) {
    // In-app notification
    notificationPromises.push(
      Notification.create({
        recipient: report.reporter._id,
        type: 'STATUS_UPDATED',
        title: 'Report Update',
        message: `Your report has been assigned to an investigating officer`,
        data: {
          reportId: report._id,
          status: report.status,
          assignedOfficer: {
            name: `${officer.firstName} ${officer.lastName}`,
            badge: officer.badgeNumber
          }
        }
      })
    );

    // Push notification for reporter
    if (report.reporter.deviceToken) {
      notificationPromises.push(
        sendOneSignalNotification({
          include_player_ids: [report.reporter.deviceToken],
          headings: { en: 'Report Update' },
          contents: { en: 'Your report has been assigned to an investigating officer' },
          data: {
            type: 'STATUS_UPDATED',
            reportId: report._id,
            status: report.status
          }
        })
      );
    }
  }

  // Send all notifications
  try {
    await Promise.allSettled(notificationPromises);
  } catch (error) {
    console.error('Notification error:', error);
  }

  res.status(statusCodes.OK).json({
    success: true,
    msg: 'Officer assigned successfully',
    data: {
      report,
      assignedOfficer: {
        id: officer._id,
        name: `${officer.firstName} ${officer.lastName}`,
        badge: officer.badgeNumber
      }
    }
  });
});

exports.getPublicFeed = asyncHandler(async (req, res) => {
  try {
    const { page = 1, limit = 10, city, type } = req.query;
    const currentPage = parseInt(page);
    const limitPerPage = parseInt(limit);

    // Base query for public reports
    let query = { 
      broadcastConsent: true,
      isPublished: true,
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
    const userRoles = req.user.roles;

    let report;

    // Case 1: Admin/Officer Access - Full Details
    if (userRoles.some(role => ['police_officer', 'police_admin', 'city_admin', 'super_admin'].includes(role))) {
      let query = { _id: reportId };
      
      if (userRoles.includes('police_officer') || userRoles.includes('police_admin')) {
        query.assignedPoliceStation = req.user.policeStation;
      } else if (userRoles.includes('city_admin')) {
        const cityStations = await PoliceStation.find({
          'address.city': req.user.address.city
        });
        query.assignedPoliceStation = { $in: cityStations.map(station => station._id) };
      }

      // Full details for officers/admins
      report = await Report.findOne(query)
  .populate('reporter', 'firstName lastName number email address')
  .populate('assignedPoliceStation')
  .populate('assignedOfficer')
  .populate('broadcastHistory.publishedBy', 'firstName lastName roles')
  .populate('consentUpdateHistory.updatedBy', 'firstName lastName')
  .select({
    type: 1,
    personInvolved: 1,
    additionalImages: 1,
    location: 1,
    status: 1,
    followUp: 1,
    broadcastConsent: 1,
    isPublished: 1,
    consentUpdateHistory: 1,
    broadcastHistory: 1,
    publishSchedule: 1,
    createdAt: 1,
    updatedAt: 1,
    reporter: 1,
    assignedPoliceStation: 1,
    assignedOfficer: 1
  });

    // Case 2: Report Owner Access - Limited Details
    } else if (userId) {
      report = await Report.findOne({
        _id: reportId,
        $or: [{ reporter: userId }, { broadcastConsent: true }]
      })
      .populate('reporter', 'firstName lastName number email address')
      .populate('assignedPoliceStation', 'name address contactNumber')
      .select(req.user.id === report?.reporter.toString() ? {
        // Full details for report owner
        reporter: 1,
        type: 1,
        personInvolved: 1,
        additionalImages: 1,
        location: 1,
        status: 1,
        followUp: 1,
        broadcastConsent: 1,
        assignedPoliceStation: 1,
        createdAt: 1,
        updatedAt: 1,
        consentUpdateHistory: 1,
        publishSchedule: 1,
        broadcastHistory: 1
      } : {
        // Limited details for public view
        type: 1,
        'personInvolved.firstName': 1,
        'personInvolved.lastName': 1,
        'personInvolved.age': 1,
        'personInvolved.dateOfBirth': 1,
        'personInvolved.lastSeenDate': 1, 
        'personInvolved.lastSeentime': 1,
        'personInvolved.lastKnownLocation': 1,
        'personInvolved.mostRecentPhoto': 1,
        'location.address': 1,
        'location.coordinates': 1,
        status: 1,
        createdAt: 1
      });

    // Case 3: Public Access - Minimal Details
    } else {
      report = await Report.findOne({
        _id: reportId,
        broadcastConsent: true
      })
      .select({
        type: 1,
        'personInvolved.firstName': 1,
        'personInvolved.lastName': 1,
        'personInvolved.age': 1,
        'personInvolved.lastSeenDate': 1,
        'personInvolved.lastSeentime': 1,
        'personInvolved.mostRecentPhoto': 1,
        'location.address': 1,
        createdAt: 1
      });
    }

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

// Search Reports
exports.searchReports = asyncHandler(async (req, res) => {
  try {
    const { 
      query, 
      page = 1, 
      limit = 10,
      status,
      type,
      startDate,
      endDate 
    } = req.query;

    const currentPage = parseInt(page);
    const limitPerPage = parseInt(limit);

    // Base search conditions
    let searchQuery = {};

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
        searchQuery.assignedPoliceStation = req.user.policeStation;
        break;

      case 'city_admin':
        // Get all stations in the admin's city
        const cityStations = await PoliceStation.find({
          'address.city': req.user.address.city
        });
        searchQuery.assignedPoliceStation = {
          $in: cityStations.map(station => station._id)
        };
        break;

      case 'super_admin':
        // Can see all reports
        break;

      default:
        return res.status(statusCodes.FORBIDDEN).json({
          success: false,
          msg: 'Not authorized to search reports'
        });
    }

    // Add text search if query provided
    if (query) {
      searchQuery.$or = [
        { 'personInvolved.firstName': { $regex: query, $options: 'i' } },
        { 'personInvolved.lastName': { $regex: query, $options: 'i' } },
        { 'personInvolved.alias': { $regex: query, $options: 'i' } },
        { 'location.address.barangay': { $regex: query, $options: 'i' } },
        { 'location.address.city': { $regex: query, $options: 'i' } }
      ];
    }

    // Add filters
    if (status) searchQuery.status = status;
    if (type) searchQuery.type = type;
    if (startDate && endDate) {
      searchQuery.createdAt = {
        $gte: new Date(startDate),
        $lte: new Date(endDate)
      };
    }

    // Execute search with pagination
    const reports = await Report.find(searchQuery)
      .populate('reporter', 'firstName lastName number email')
      .populate('assignedPoliceStation', 'name address')
      .populate('assignedOfficer', 'firstName lastName number')
      .select({
        type: 1,
        status: 1,
        'personInvolved.firstName': 1,
        'personInvolved.lastName': 1,
        'personInvolved.alias': 1,
        'personInvolved.age': 1,
        'personInvolved.lastSeenDate': 1,
        'personInvolved.lastSeentime': 1,
        'personInvolved.mostRecentPhoto': 1,
        'location.address': 1,
        createdAt: 1
      })
      .sort('-createdAt')
      .skip((currentPage - 1) * limitPerPage)
      .limit(limitPerPage);

    const total = await Report.countDocuments(searchQuery);

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
    console.error('Error searching reports:', error);
    res.status(statusCodes.INTERNAL_SERVER_ERROR).json({
      success: false,
      msg: 'Error searching reports',
      error: error.message
    });
  }
});


// Reassign report to different police station
exports.reassignPoliceStation = asyncHandler(async (req, res) => {
  try {
    const { reportId, newStationId } = req.body;
    
    // Authorization check
    if (!req.user.roles.some(role => ['city_admin', 'super_admin'].includes(role))) {
      return res.status(statusCodes.FORBIDDEN).json({
        success: false,
        msg: 'Only city admin or super admin can reassign police stations'
      });
    }

    // Get report details
    const report = await Report.findById(reportId)
      .populate('assignedPoliceStation')
      .populate('reporter');
    
    if (!report) {
      return res.status(statusCodes.NOT_FOUND).json({
        success: false,
        msg: errorMessages.REPORT_NOT_FOUND
      });
    }

    // Get new station
    const newStation = await PoliceStation.findById(newStationId);
    if (!newStation) {
      return res.status(statusCodes.NOT_FOUND).json({
        success: false,
        msg: 'New police station not found'
      });
    }

    const oldStation = report.assignedPoliceStation;
    
    // Update report
    report.assignedPoliceStation = newStationId;
    report.assignedOfficer = null;
    await report.save();

    // Notification promises array
    const notificationPromises = [];

    // 1. Notify old station admins
    const oldStationAdmins = await User.find({
      policeStation: oldStation._id,
      roles: 'police_admin',
      deviceToken: { $exists: true }
    });

    oldStationAdmins.forEach(admin => {
      notificationPromises.push(
        sendOneSignalNotification({
          include_player_ids: [admin.deviceToken],
          headings: { en: 'Report Reassigned' },
          contents: { en: `Report #${report._id} has been reassigned to ${newStation.name}` },
          data: { 
            type: 'REPORT_REASSIGNED',
            reportId: report._id 
          }
        })
      );
    });

    // 2. Notify new station admins
    const newStationAdmins = await User.find({
      policeStation: newStationId,
      roles: 'police_admin',
      deviceToken: { $exists: true }
    });

    newStationAdmins.forEach(admin => {
      notificationPromises.push(
        sendOneSignalNotification({
          include_player_ids: [admin.deviceToken],
          headings: { en: 'New Report Assignment' },
          contents: { en: `A new report has been assigned to your station` },
          data: { 
            type: 'NEW_REPORT_ASSIGNED',
            reportId: report._id 
          }
        })
      );
    });

    // 3. Notify reporter
    if (report.reporter?.deviceToken) {
      notificationPromises.push(
        sendOneSignalNotification({
          include_player_ids: [report.reporter.deviceToken],
          headings: { en: 'Report Update' },
          contents: { en: `Your report has been reassigned to ${newStation.name}` },
          data: { 
            type: 'REPORT_REASSIGNED',
            reportId: report._id,
            oldStation: oldStation.name,
            newStation: newStation.name
          }
        })
      );
    }

    // Send all notifications
    await Promise.allSettled(notificationPromises);

    res.status(statusCodes.OK).json({
      success: true,
      msg: `Report reassigned to ${newStation.name}`,
      data: {
        report,
        oldStation: oldStation.name,
        newStation: newStation.name
      }
    });

  } catch (error) {
    console.error('Error reassigning police station:', error);
    res.status(statusCodes.INTERNAL_SERVER_ERROR).json({
      success: false,
      msg: 'Error reassigning police station',
      error: error.message
    });
  }
});
