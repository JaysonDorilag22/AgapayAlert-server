const PoliceStation = require('../models/policeStationModel');
const City = require('../models/cityModel');
const asyncHandler = require('express-async-handler');
const statusCodes = require('../constants/statusCodes');
const errorMessages = require('../constants/errorMessages');
const uploadToCloudinary = require('../utils/uploadToCloudinary');
const cloudinary = require('cloudinary').v2;
const { getCoordinatesFromAddress } = require('../utils/geocoding');
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

function calculateDistance(coords1, coords2) {
  const R = 6371; // Earth's radius in km
  const [lon1, lat1] = coords1;
  const [lon2, lat2] = coords2;
  
  const dLat = (lat2 - lat1) * (Math.PI/180);
  const dLon = (lon2 - lon1) * (Math.PI/180);
  
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
           Math.cos(lat1 * (Math.PI/180)) * Math.cos(lat2 * (Math.PI/180)) *
           Math.sin(dLon/2) * Math.sin(dLon/2);
  
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c; // Distance in km
}

exports.searchPoliceStations = asyncHandler(async (req, res) => {
  const { address } = req.body;
  
  try {
    const geoData = await getCoordinatesFromAddress(address);
    if (!geoData.success) {
      return res.status(statusCodes.BAD_REQUEST).json({
        msg: geoData.message
      });
    }

    // Try initial 10km radius (accounts for road distance being longer than direct distance)
    let policeStations = await PoliceStation.find({
      location: {
        $near: {
          $geometry: {
            type: 'Point',
            coordinates: geoData.coordinates
          },
          $maxDistance: 10000 // 10km radius
        }
      }
    }).populate('city');

    // If no stations found, try 20km
    if (policeStations.length === 0) {
      policeStations = await PoliceStation.find({
        location: {
          $near: {
            $geometry: {
              type: 'Point',
              coordinates: geoData.coordinates
            },
            $maxDistance: 20000 // 20km radius
          }
        }
      }).populate('city');
    }

    // If still no stations, try 30km
    if (policeStations.length === 0) {
      policeStations = await PoliceStation.find({
        location: {
          $near: {
            $geometry: {
              type: 'Point',
              coordinates: geoData.coordinates
            },
            $maxDistance: 30000 // 30km radius
          }
        }
      }).limit(5).populate('city'); // Limit to 5 nearest stations
    }

    // Calculate actual road distance and add to each station
    policeStations = policeStations.map(station => {
      const directDistance = calculateDistance(
        geoData.coordinates,
        station.location.coordinates
      );
      // Estimate road distance (typically 20-30% longer than direct distance)
      const estimatedRoadDistance = directDistance * 1.3;
      return {
        ...station.toObject(),
        directDistance: parseFloat(directDistance.toFixed(2)),
        estimatedRoadDistance: parseFloat(estimatedRoadDistance.toFixed(2))
      };
    });

    // Sort by estimated road distance
    policeStations.sort((a, b) => a.estimatedRoadDistance - b.estimatedRoadDistance);

    res.status(statusCodes.OK).json({
      success: true,
      policeStations,
      coordinates: geoData.coordinates,
      addressUsed: geoData.addressUsed,
      searchRadius: policeStations.length > 0 ? 
        `Approximately ${policeStations[0].estimatedRoadDistance} km by road` : 'No stations found'
    });

  } catch (error) {
    console.error('Search error:', error);
    res.status(statusCodes.INTERNAL_SERVER_ERROR).json({
      success: false,
      msg: 'Error searching police stations',
      error: error.message
    });
  }
});