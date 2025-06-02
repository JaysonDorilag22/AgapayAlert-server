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

  console.log('Creating police station with data:', { name, city, address });

  // Parse address if it's a string
  let parsedAddress;
  if (typeof address === 'string') {
    try {
      parsedAddress = JSON.parse(address);
    } catch (error) {
      return res.status(statusCodes.BAD_REQUEST).json({
        success: false,
        msg: 'Invalid address format. Please provide a valid JSON string or object.',
      });
    }
  } else {
    parsedAddress = address;
  }

  console.log('Parsed address:', parsedAddress);

  // Handle city - either by ObjectId or by name
  let cityId;
  
  if (city && city.length === 24) {
    // Assume it's an ObjectId
    const cityExists = await City.findById(city);
    if (!cityExists) {
      return res.status(statusCodes.NOT_FOUND).json({
        success: false,
        msg: 'City with provided ID not found',
      });
    }
    cityId = city;
    console.log('Using existing city by ID:', cityExists.name);
  } else if (city && typeof city === 'string') {
    // Try to find city by name, create if not exists
    let existingCity = await City.findOne({ name: city });
    
    if (!existingCity) {
      console.log('City not found, creating new city:', city);
      existingCity = new City({ name: city });
      await existingCity.save();
      console.log('Created new city:', existingCity);
    }
    
    cityId = existingCity._id;
    console.log('Using city by name:', existingCity.name, 'ID:', cityId);
  } else {
    return res.status(statusCodes.BAD_REQUEST).json({
      success: false,
      msg: 'Valid city name or city ID is required',
    });
  }

  // Check if police station already exists (by name and city)
  let existingStation = await PoliceStation.findOne({ name, city: cityId });
  if (existingStation) {
    return res.status(statusCodes.CONFLICT).json({ 
      success: false,
      msg: errorMessages.POLICE_STATION_ALREADY_EXISTS 
    });
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

  // Handle coordinates - use provided coordinates or geocode from address
  let coordinates;
  
  if (location && location.coordinates && Array.isArray(location.coordinates) && location.coordinates.length === 2) {
    // Use provided coordinates
    coordinates = location.coordinates;
    console.log('Using provided coordinates:', coordinates);
  } else if (parsedAddress) {
    // Geocode from address
    console.log('Geocoding address for police station:', parsedAddress);
    const geoData = await getCoordinatesFromAddress(parsedAddress);
    
    if (!geoData.success) {
      return res.status(statusCodes.BAD_REQUEST).json({
        success: false,
        msg: `Failed to get coordinates from address: ${geoData.message}`,
      });
    }
    
    coordinates = geoData.coordinates;
    console.log('Geocoded coordinates:', coordinates, 'from:', geoData.displayName);
  } else {
    return res.status(statusCodes.BAD_REQUEST).json({
      success: false,
      msg: 'Either coordinates or a complete address must be provided',
    });
  }

  // Validate address fields
  if (!parsedAddress || !parsedAddress.streetAddress || !parsedAddress.barangay || !parsedAddress.city || !parsedAddress.zipCode) {
    return res.status(statusCodes.BAD_REQUEST).json({
      success: false,
      msg: 'Complete address information is required (streetAddress, barangay, city, zipCode)',
    });
  }

  const policeStation = new PoliceStation({
    name,
    city: cityId, // Use the ObjectId
    location: {
      type: 'Point',
      coordinates: coordinates,
    },
    address: {
      streetAddress: parsedAddress.streetAddress,
      barangay: parsedAddress.barangay,
      city: parsedAddress.city,
      zipCode: parsedAddress.zipCode,
    },
    image,
  });

  await policeStation.save();

  // Update the city with the new police station
  await City.findByIdAndUpdate(cityId, { $push: { policeStations: policeStation._id } });

  // Populate the city information for the response
  await policeStation.populate('city');

  res.status(statusCodes.CREATED).json({
    success: true,
    data: policeStation,
    coordinatesSource: location && location.coordinates ? 'provided' : 'geocoded'
  });
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
// Update a police station
exports.updatePoliceStation = asyncHandler(async (req, res) => {
  const { policeStationId } = req.params;
  const { name, city, location, address } = req.body;
  const file = req.file;

  console.log('Updating police station with data:', { name, city, address });

  let policeStation = await PoliceStation.findById(policeStationId);

  if (!policeStation) {
    return res.status(statusCodes.NOT_FOUND).json({ 
      success: false,
      msg: errorMessages.POLICE_STATION_NOT_FOUND 
    });
  }

  // Update name if provided
  if (name) {
    policeStation.name = name;
  }

  // Handle city update - either by ObjectId or by name
  if (city) {
    let cityId;
    
    if (city && city.length === 24) {
      // Assume it's an ObjectId
      const cityExists = await City.findById(city);
      if (!cityExists) {
        return res.status(statusCodes.NOT_FOUND).json({
          success: false,
          msg: 'City with provided ID not found',
        });
      }
      cityId = city;
      console.log('Using existing city by ID:', cityExists.name);
    } else if (city && typeof city === 'string') {
      // Try to find city by name, create if not exists
      let existingCity = await City.findOne({ name: city });
      
      if (!existingCity) {
        console.log('City not found, creating new city:', city);
        existingCity = new City({ name: city });
        await existingCity.save();
        console.log('Created new city:', existingCity);
      }
      
      cityId = existingCity._id;
      console.log('Using city by name:', existingCity.name, 'ID:', cityId);
    } else {
      return res.status(statusCodes.BAD_REQUEST).json({
        success: false,
        msg: 'Valid city name or city ID is required',
      });
    }

    // Remove from old city's police stations array
    if (policeStation.city.toString() !== cityId.toString()) {
      await City.findByIdAndUpdate(policeStation.city, { 
        $pull: { policeStations: policeStation._id } 
      });
      
      // Add to new city's police stations array
      await City.findByIdAndUpdate(cityId, { 
        $push: { policeStations: policeStation._id } 
      });
    }

    policeStation.city = cityId;
  }

  // Parse address if it's a string
  let parsedAddress;
  if (address) {
    if (typeof address === 'string') {
      try {
        parsedAddress = JSON.parse(address);
      } catch (error) {
        return res.status(statusCodes.BAD_REQUEST).json({
          success: false,
          msg: 'Invalid address format. Please provide a valid JSON string or object.',
        });
      }
    } else {
      parsedAddress = address;
    }

    console.log('Parsed address for update:', parsedAddress);

    // Validate address fields if provided
    if (parsedAddress && (!parsedAddress.streetAddress || !parsedAddress.barangay || !parsedAddress.city || !parsedAddress.zipCode)) {
      return res.status(statusCodes.BAD_REQUEST).json({
        success: false,
        msg: 'Complete address information is required (streetAddress, barangay, city, zipCode)',
      });
    }
  }
  
  // Handle location and coordinates updates
  if (location || parsedAddress) {
    let coordinates;
    
    if (location && location.coordinates && Array.isArray(location.coordinates) && location.coordinates.length === 2) {
      // Use provided coordinates
      coordinates = location.coordinates;
      console.log('Using provided coordinates for update:', coordinates);
    } else if (parsedAddress) {
      // Geocode from address if no valid coordinates provided
      console.log('Geocoding updated address for police station:', parsedAddress);
      const geoData = await getCoordinatesFromAddress(parsedAddress);
      
      if (!geoData.success) {
        return res.status(statusCodes.BAD_REQUEST).json({
          success: false,
          msg: `Failed to get coordinates from address: ${geoData.message}`,
        });
      }
      
      coordinates = geoData.coordinates;
      console.log('Geocoded coordinates for update:', coordinates, 'from:', geoData.displayName);
    }
    
    if (coordinates) {
      policeStation.location = {
        type: 'Point',
        coordinates: coordinates,
      };
    }
  }
  
  // Update address if provided
  if (parsedAddress) {
    policeStation.address = {
      streetAddress: parsedAddress.streetAddress,
      barangay: parsedAddress.barangay,
      city: parsedAddress.city,
      zipCode: parsedAddress.zipCode,
    };
  }

  // Handle image update
  if (file) {
    // Delete the old image from Cloudinary (if not default)
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

  // Populate the city information for the response
  await policeStation.populate('city');

  res.status(statusCodes.OK).json({
    success: true,
    data: policeStation,
    coordinatesSource: (location && location.coordinates) ? 'provided' : 'geocoded',
    message: 'Police station updated successfully'
  });
});

// Delete a police station
exports.deletePoliceStation = asyncHandler(async (req, res) => {
  console.log('Deleting police station...');
  console.log('Request Params:', req.params);
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

  await policeStation.deleteOne();

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