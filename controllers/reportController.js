const Report = require('../models/reportModel.v2');
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

    // Get coordinates from address
    const geoData = await getCoordinatesFromAddress(location.address);
    if (!geoData.success) {
      return res.status(statusCodes.BAD_REQUEST).json({
        msg: geoData.message
      });
    }

    // Upload most recent photo
    if (!req.files?.['personInvolved[mostRecentPhoto]']) {
      return res.status(statusCodes.BAD_REQUEST).json({
        msg: 'Most recent photo is required'
      });
    }

    const photoFile = req.files['personInvolved[mostRecentPhoto]'][0];
    const photoResult = await uploadToCloudinary(photoFile.path, 'reports');
    
    // Find police station based on selection or location
    let assignedStation = await findPoliceStation(selectedPoliceStation, geoData.coordinates);

    if (!assignedStation) {
      return res.status(statusCodes.NOT_FOUND).json({
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
      await notifyPoliceStation(report, assignedStation);
    } catch (notificationError) {
      console.error('Notification failed but report was saved:', notificationError);
    }

    res.status(statusCodes.CREATED).json({
      msg: 'Report created successfully',
      report,
      assignedStation,
      assignmentType: selectedPoliceStation ? 'Manual Selection' : 'Automatic Assignment',
      notificationStatus: 'Report saved successfully. Notifications may have failed.'
    });

  } catch (error) {
    console.error('Error in createReport:', error);
    res.status(statusCodes.INTERNAL_SERVER_ERROR).json({
      msg: 'Error creating report',
      error: error.message
    });
  }
});


// Get Reports (with filters)
exports.getReports = asyncHandler(async (req, res) => {
  const { status, location, type, startDate, endDate } = req.query;

  const query = {};
  
  if (status) query.status = status;
  if (type) query.type = type;
  if (startDate && endDate) {
    query.createdAt = {
      $gte: new Date(startDate),
      $lte: new Date(endDate)
    };
  }
  if (location) {
    query.location = {
      $near: {
        $geometry: {
          type: 'Point',
          coordinates: location.split(',').map(Number)
        },
        $maxDistance: 5000
      }
    };
  }

  const reports = await Report.find(query)
    .populate('reporter', '-password')
    .populate('assignedPoliceStation')
    .sort('-createdAt');

  res.status(statusCodes.OK).json(reports);
});

// Update Report (Police)
exports.updateReport = asyncHandler(async (req, res) => {
  const { reportId } = req.params;
  const { status, followUp } = req.body;
  const isOfficer = req.user.roles.includes('police');

  if (!isOfficer) {
    return res.status(statusCodes.FORBIDDEN).json({
      msg: 'Only police officers can update reports'
    });
  }

  const report = await Report.findById(reportId);
  if (!report) {
    return res.status(statusCodes.NOT_FOUND).json({
      msg: errorMessages.REPORT_NOT_FOUND
    });
  }

  if (status) report.status = status;
  if (followUp) report.followUp = followUp;

  // Handle additional images
  if (req.files?.additionalImages) {
    for (const file of req.files.additionalImages) {
      const result = await uploadToCloudinary(file.path, 'reports');
      report.additionalImages.push({
        url: result.url,
        public_id: result.public_id
      });
    }
  }

  await report.save();
  res.status(statusCodes.OK).json(report);
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

