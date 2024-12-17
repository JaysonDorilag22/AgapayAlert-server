const City = require('../models/cityModel');
const asyncHandler = require('express-async-handler');
const statusCodes = require('../constants/statusCodes');
const errorMessages = require('../constants/errorMessages');
const uploadToCloudinary = require('../utils/uploadToCloudinary');
const cloudinary = require('cloudinary').v2;

// Create a new city
exports.createCity = asyncHandler(async (req, res) => {
  const { name } = req.body;
  const file = req.file; 
  let city = await City.findOne({ name });
  if (city) {
    return res.status(statusCodes.CONFLICT).json({ msg: errorMessages.CITY_ALREADY_EXISTS });
  }

  let image = {
    url: 'https://via.placeholder.com/150',
    public_id: 'default_image',
  };

  if (file) {
    const uploadResult = await uploadToCloudinary(file.path, 'cities');
    image = {
      url: uploadResult.url,
      public_id: uploadResult.public_id,
    };
  }

  city = new City({
    name,
    image,
  });

  await city.save();

  res.status(statusCodes.CREATED).json(city);
});

// Get all cities
exports.getCities = asyncHandler(async (req, res) => {
  const cities = await City.find().populate('policeStations');
  res.status(statusCodes.OK).json(cities);
});

// Get a single city by ID
exports.getCityById = asyncHandler(async (req, res) => {
  const { cityId } = req.params;
  const city = await City.findById(cityId).populate('policeStations');

  if (!city) {
    return res.status(statusCodes.NOT_FOUND).json({ msg: errorMessages.CITY_NOT_FOUND });
  }

  res.status(statusCodes.OK).json(city);
});

// Update a city
exports.updateCity = asyncHandler(async (req, res) => {
  const { cityId } = req.params;
  const { name } = req.body;
  const file = req.file; 
  let city = await City.findById(cityId);

  if (!city) {
    return res.status(statusCodes.NOT_FOUND).json({ msg: errorMessages.CITY_NOT_FOUND });
  }

  if (name) {
    city.name = name;
  }

  if (file) {
    if (city.image.public_id !== 'default_image') {
      await cloudinary.uploader.destroy(city.image.public_id);
    }

    const uploadResult = await uploadToCloudinary(file.path, 'cities');
    city.image = {
      url: uploadResult.url,
      public_id: uploadResult.public_id,
    };
  }

  await city.save();

  res.status(statusCodes.OK).json(city);
});

// Delete a city
exports.deleteCity = asyncHandler(async (req, res) => {
  const { cityId } = req.params;

  const city = await City.findById(cityId);

  if (!city) {
    return res.status(statusCodes.NOT_FOUND).json({ msg: errorMessages.CITY_NOT_FOUND });
  }

  // Delete the image from Cloudinary
  if (city.image.public_id !== 'default_image') {
    await cloudinary.uploader.destroy(city.image.public_id);
  }

  await city.deleteOne();

  res.status(statusCodes.OK).json({ msg: 'City deleted successfully' });
});