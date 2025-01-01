const PoliceStation = require('../models/policeStationModel');
const City = require('../models/cityModel');
const asyncHandler = require('express-async-handler');
const statusCodes = require('../constants/statusCodes');
const errorMessages = require('../constants/errorMessages');
const uploadToCloudinary = require('../utils/uploadToCloudinary');
const cloudinary = require('cloudinary').v2;

// Create a new police station
exports.createPoliceStation = asyncHandler(async (req, res) => {
  const { name, city, location, address } = req.body;
  const file = req.file;

  let policeStation = await PoliceStation.findOne({ name, city });
  if (policeStation) {
    return res.status(statusCodes.CONFLICT).json({ msg: errorMessages.POLICE_STATION_ALREADY_EXISTS });
  }

  let image = {
    url: 'https://via.placeholder.com/150',
    public_id: 'default_image',
  };

  if (file) {
    const uploadResult = await uploadToCloudinary(file.path, 'police_stations');
    image = {
      url: uploadResult.url,
      public_id: uploadResult.public_id,
    };
  }

  policeStation = new PoliceStation({
    name,
    city,
    location: {
      type: 'Point',
      coordinates: location.coordinates,
    },
    address: {
      streetAddress: address.streetAddress,
      barangay: address.barangay,
      city: address.city,
      zipCode: address.zipCode,
    },
    image,
  });

  await policeStation.save();

  // Update the city with the new police station
  await City.findByIdAndUpdate(city, { $push: { policeStations: policeStation._id } });

  res.status(statusCodes.CREATED).json(policeStation);
});

// Get all police stations
exports.getPoliceStations = asyncHandler(async (req, res) => {
  const policeStations = await PoliceStation.find().populate('city');
  res.status(statusCodes.OK).json(policeStations);
});

// Get a single police station by ID
exports.getPoliceStationById = asyncHandler(async (req, res) => {
  const { policeStationId } = req.params;
  const policeStation = await PoliceStation.findById(policeStationId).populate('city');

  if (!policeStation) {
    return res.status(statusCodes.NOT_FOUND).json({ msg: errorMessages.POLICE_STATION_NOT_FOUND });
  }

  res.status(statusCodes.OK).json(policeStation);
});

// Update a police station
exports.updatePoliceStation = asyncHandler(async (req, res) => {
  const { policeStationId } = req.params;
  const { name, city, location, address } = req.body;
  const file = req.file;

  let policeStation = await PoliceStation.findById(policeStationId);

  if (!policeStation) {
    return res.status(statusCodes.NOT_FOUND).json({ msg: errorMessages.POLICE_STATION_NOT_FOUND });
  }

  if (name) {
    policeStation.name = name;
  }
  if (city) {
    policeStation.city = city;
  }
  if (location) {
    policeStation.location = {
      type: 'Point',
      coordinates: location.coordinates,
    };
  }
  if (address) {
    policeStation.address = {
      streetAddress: address.streetAddress,
      barangay: address.barangay,
      city: address.city,
      zipCode: address.zipCode,
    };
  }

  if (file) {
    // Delete the old image from Cloudinary
    if (policeStation.image.public_id !== 'default_image') {
      await cloudinary.uploader.destroy(policeStation.image.public_id);
    }

    // Upload the new image to Cloudinary
    const uploadResult = await uploadToCloudinary(file.path, 'police_stations');
    policeStation.image = {
      url: uploadResult.url,
      public_id: uploadResult.public_id,
    };
  }

  await policeStation.save();

  res.status(statusCodes.OK).json(policeStation);
});

// Delete a police station
exports.deletePoliceStation = asyncHandler(async (req, res) => {
  const { policeStationId } = req.params;

  const policeStation = await PoliceStation.findById(policeStationId);

  if (!policeStation) {
    return res.status(statusCodes.NOT_FOUND).json({ msg: errorMessages.POLICE_STATION_NOT_FOUND });
  }

  // Delete the image from Cloudinary
  if (policeStation.image.public_id !== 'default_image') {
    await cloudinary.uploader.destroy(policeStation.image.public_id);
  }

  // Remove the police station from the city's policeStations array
  await City.findByIdAndUpdate(policeStation.city, { $pull: { policeStations: policeStation._id } });

  await policeStation.remove();

  res.status(statusCodes.OK).json({ msg: 'Police station deleted successfully' });
});