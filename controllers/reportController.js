const Report = require('../models/reportModel');
const User = require('../models/userModel');
const PoliceStation = require('../models/policeStationModel');
const asyncHandler = require('express-async-handler');
const statusCodes = require('../constants/statusCodes');
const errorMessages = require('../constants/errorMessages');
const uploadToCloudinary = require('../utils/uploadToCloudinary');
const cloudinary = require('cloudinary').v2;


// Create a new report
exports.createReport = asyncHandler(async (req, res) => {
  console.log('Request Body:', req.body);
  console.log('Request Files:', req.files);

  const { type, details, personInvolved, location, dateTime } = req.body;
  const reporter = req.user.id;

  // Upload images to Cloudinary
  const images = [];
  if (req.files && req.files.images) {
    for (const file of req.files.images) {
      const uploadResult = await uploadToCloudinary(file.path, 'reports');
      images.push({
        url: uploadResult.url,
        public_id: uploadResult.public_id,
      });
    }
  }

  // Upload most recent photo to Cloudinary
  let mostRecentPhoto = {};
  if (req.files && req.files['personInvolved[mostRecentPhoto]']) {
    const file = req.files['personInvolved[mostRecentPhoto]'][0];
    const uploadResult = await uploadToCloudinary(file.path, 'reports');
    mostRecentPhoto = {
      url: uploadResult.url,
      public_id: uploadResult.public_id,
    };
  }

  // Find the nearest police station based on location
  const nearestStation = await PoliceStation.findOne({
    location: {
      $near: {
        $geometry: {
          type: 'Point',
          coordinates: location.coordinates,
        },
        $maxDistance: 5000, // 5 km radius
      },
    },
  });

  const report = new Report({
    reporter,
    type,
    details: {
      ...details,
      images,
    },
    personInvolved: {
      ...personInvolved,
      mostRecentPhoto,
    },
    location: {
      type: 'Point',
      coordinates: location.coordinates,
      address: {
        streetAddress: location.address.streetAddress,
        barangay: location.address.barangay,
        city: location.address.city,
        province: location.address.province,
        zipCode: location.address.zipCode,
      },
    },
    assignedPoliceStation: nearestStation ? nearestStation._id : null,
    dateTime,
  });

  await report.save();

  res.status(statusCodes.CREATED).json(report);
});

// Update a report
exports.updateReport = asyncHandler(async (req, res) => {
  const { reportId } = req.params;
  const { status, followUp, additionalImages } = req.body;

  const report = await Report.findById(reportId);

  if (!report) {
    return res.status(statusCodes.NOT_FOUND).json({ msg: errorMessages.REPORT_NOT_FOUND });
  }

  // Update status and follow-up notes
  if (status) report.status = status;
  if (followUp) report.followUp = followUp;

  // Upload additional images to Cloudinary
  if (additionalImages) {
    for (const file of additionalImages) {
      const uploadResult = await uploadToCloudinary(file.path, 'reports');
      report.details.images.push({
        url: uploadResult.url,
        public_id: uploadResult.public_id,
      });
    }
  }

  await report.save();

  res.status(statusCodes.OK).json(report);
});

// Retrieve reports
exports.getReports = asyncHandler(async (req, res) => {
  const { status, location } = req.query;

  const query = {};
  if (status) query.status = status;
  if (location) {
    query.location = {
      $near: {
        $geometry: {
          type: 'Point',
          coordinates: location.split(',').map(Number),
        },
        $maxDistance: 5000, // 5 km radius
      },
    };
  }

  const reports = await Report.find(query).populate('reporter assignedPoliceStation assignedOfficer');

  res.status(statusCodes.OK).json(reports);
});

// Delete a report
exports.deleteReport = asyncHandler(async (req, res) => {
  const { reportId } = req.params;

  const report = await Report.findById(reportId);

  if (!report) {
    return res.status(statusCodes.NOT_FOUND).json({ msg: errorMessages.REPORT_NOT_FOUND });
  }

  // Delete images from Cloudinary
  for (const image of report.details.images) {
    await cloudinary.uploader.destroy(image.public_id);
  }

  await report.remove();

  res.status(statusCodes.OK).json({ msg: 'Report deleted successfully' });
});

// Assign a police station to a report
exports.assignPoliceStation = asyncHandler(async (req, res) => {
  const { reportId, policeStationId } = req.body;

  const report = await Report.findById(reportId);
  const policeStation = await PoliceStation.findById(policeStationId);

  if (!report) {
    return res.status(statusCodes.NOT_FOUND).json({ msg: errorMessages.REPORT_NOT_FOUND });
  }

  if (!policeStation) {
    return res.status(statusCodes.NOT_FOUND).json({ msg: errorMessages.POLICE_STATION_NOT_FOUND });
  }

  report.assignedPoliceStation = policeStation._id;
  await report.save();

  res.status(statusCodes.OK).json(report);
});