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
  const { address, coordinates } = req.body;
  
  try {
    let searchCoordinates;
    let searchMethod;

    // Log received query parameters
    console.log('\n=== Search Request Details ===');
    console.log('Input received:', {
      coordinates: coordinates || 'Not provided',
      address: address || 'Not provided'
    });

    // Determine search method
    if (coordinates && Array.isArray(coordinates) && coordinates.length === 2) {
      searchCoordinates = coordinates.map(coord => parseFloat(coord.toFixed(7)));
      searchMethod = "USER_CURRENT_LOCATION";
      console.log('Search Method: Using user\'s current location');
      console.log('Normalized Coordinates:', searchCoordinates);
    } else if (address) {
      const geoData = await getCoordinatesFromAddress(address);
      if (!geoData.success) {
        return res.status(statusCodes.BAD_REQUEST).json({
          success: false,
          msg: geoData.message
        });
      }
      searchCoordinates = geoData.coordinates.map(coord => parseFloat(coord.toFixed(7)));
      searchMethod = "ADDRESS_LOCATION";
      console.log('Search Method: Using provided address');
      console.log('Address:', address);
      console.log('Normalized Coordinates:', searchCoordinates);
    } else {
      return res.status(statusCodes.BAD_REQUEST).json({
        success: false,
        msg: 'Either coordinates or address must be provided'
      });
    }

    // Search with expanding radius
    const searchRadii = [5000, 10000, 15000]; // 5km, 10km, 15km
    let policeStations = [];

    for (const radius of searchRadii) {
      console.log(`\nSearching within ${radius/1000}km radius`);
      policeStations = await PoliceStation.find({
        location: {
          $near: {
            $geometry: {
              type: 'Point',
              coordinates: searchCoordinates
            },
            $maxDistance: radius
          }
        }
      }).populate('city');

      if (policeStations.length > 0) {
        console.log(`Found ${policeStations.length} stations within ${radius/1000}km`);
        break;
      }
    }

    // Limit to 5 nearest stations
    policeStations = policeStations.slice(0, 5);

    // Calculate distances with validation
    policeStations = policeStations.map(station => {
      const stationObj = station.toObject();
      
      console.log(`\n=== Distance Calculation for ${station.name} ===`);
      console.log('From:', searchCoordinates);
      console.log('To:', station.location.coordinates);
      
      try {
        const directDistance = calculateDistance(
          searchCoordinates,
          station.location.coordinates
        );
        
        console.log('Raw Direct Distance:', directDistance);
        const normalizedDirectDistance = parseFloat(directDistance.toFixed(2));
        const estimatedRoadDistance = parseFloat((directDistance * 1.3).toFixed(2));
        
        console.log('Normalized Direct Distance:', normalizedDirectDistance);
        console.log('Estimated Road Distance:', estimatedRoadDistance);

        return {
          ...stationObj,
          directDistance: normalizedDirectDistance,
          estimatedRoadDistance: estimatedRoadDistance,
          searchMethod
        };
      } catch (error) {
        console.error('Distance calculation error:', error);
        return {
          ...stationObj,
          directDistance: null,
          estimatedRoadDistance: null,
          error: 'Failed to calculate distance'
        };
      }
    });

    // Sort by estimated road distance
    policeStations.sort((a, b) => {
      if (!a.estimatedRoadDistance) return 1;
      if (!b.estimatedRoadDistance) return -1;
      return a.estimatedRoadDistance - b.estimatedRoadDistance;
    });

    res.status(statusCodes.OK).json({
      success: true,
      searchMethod,
      searchCoordinates,
      policeStations,
      totalFound: policeStations.length,
      nearestStation: policeStations[0] ? {
        name: policeStations[0].name,
        distance: policeStations[0].estimatedRoadDistance
      } : null
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