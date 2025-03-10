const EmergencyContact = require('../models/emergencyContactModel');
const asyncHandler = require('express-async-handler');
const statusCodes = require('../constants/statusCodes');
const errorMessages = require('../constants/errorMessages');
const { getCoordinatesFromAddress } = require('../utils/geocoding');

// Calculate distance between two coordinates in km
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

// Get all emergency contacts
exports.getAllEmergencyContacts = asyncHandler(async (req, res) => {
  const contacts = await EmergencyContact.find();
  res.status(statusCodes.OK).json({
    success: true,
    count: contacts.length,
    data: contacts
  });
});

// Get emergency contact by ID
exports.getEmergencyContactById = asyncHandler(async (req, res) => {
  const { contactId } = req.params;
  const contact = await EmergencyContact.findById(contactId);
  
  if (!contact) {
    return res.status(statusCodes.NOT_FOUND).json({
      success: false,
      msg: 'Emergency contact not found'
    });
  }
  
  res.status(statusCodes.OK).json({
    success: true,
    data: contact
  });
});

// Create new emergency contact
exports.createEmergencyContact = asyncHandler(async (req, res) => {
  const { name, type, contactNumbers, address } = req.body;
  
  // Get coordinates from address
  const geoData = await getCoordinatesFromAddress(address);
  if (!geoData.success) {
    return res.status(statusCodes.BAD_REQUEST).json({
      success: false,
      msg: geoData.message
    });
  }
  
  const contact = await EmergencyContact.create({
    name,
    type,
    contactNumbers,
    address,
    location: {
      type: 'Point',
      coordinates: geoData.coordinates
    }
  });
  
  res.status(statusCodes.CREATED).json({
    success: true,
    data: contact
  });
});

// Update emergency contact
exports.updateEmergencyContact = asyncHandler(async (req, res) => {
  const { contactId } = req.params;
  const { name, type, contactNumbers, address } = req.body;
  
  let contact = await EmergencyContact.findById(contactId);
  if (!contact) {
    return res.status(statusCodes.NOT_FOUND).json({
      success: false,
      msg: 'Emergency contact not found'
    });
  }
  
  // Update location coordinates if address is changed
  let locationUpdate = {};
  if (address) {
    const geoData = await getCoordinatesFromAddress(address);
    if (!geoData.success) {
      return res.status(statusCodes.BAD_REQUEST).json({
        success: false,
        msg: geoData.message
      });
    }
    
    locationUpdate = {
      location: {
        type: 'Point',
        coordinates: geoData.coordinates
      }
    };
  }
  
  contact = await EmergencyContact.findByIdAndUpdate(
    contactId,
    {
      name,
      type,
      contactNumbers,
      address,
      ...locationUpdate
    },
    { new: true, runValidators: true }
  );
  
  res.status(statusCodes.OK).json({
    success: true,
    data: contact
  });
});

// Delete emergency contact
exports.deleteEmergencyContact = asyncHandler(async (req, res) => {
  const { contactId } = req.params;
  
  const contact = await EmergencyContact.findById(contactId);
  if (!contact) {
    return res.status(statusCodes.NOT_FOUND).json({
      success: false,
      msg: 'Emergency contact not found'
    });
  }
  
  await contact.deleteOne();
  
  res.status(statusCodes.OK).json({
    success: true,
    msg: 'Emergency contact deleted successfully'
  });
});

// Get nearest emergency contacts based on user location
exports.getNearestEmergencyContacts = asyncHandler(async (req, res) => {
  try {
    const { latitude, longitude, type, radius = 5, maxResults = 5 } = req.query;
    
    // Validate coordinates
    if (!latitude || !longitude) {
      // Try to get coordinates from user's address if provided
      if (req.query.address) {
        const geoData = await getCoordinatesFromAddress(req.query.address);
        if (!geoData.success) {
          return res.status(statusCodes.BAD_REQUEST).json({
            success: false,
            msg: 'Location coordinates or valid address is required'
          });
        }
        
        const [longitude, latitude] = geoData.coordinates;
        return await findNearbyContacts([parseFloat(longitude), parseFloat(latitude)]);
      } else {
        return res.status(statusCodes.BAD_REQUEST).json({
          success: false,
          msg: 'Location coordinates or address is required'
        });
      }
    }
    
    const coordinates = [parseFloat(longitude), parseFloat(latitude)];
    
    // Find nearby emergency contacts
    return await findNearbyContacts(coordinates);
    
    // Function to find and return nearby contacts
    async function findNearbyContacts(coordinates) {
      console.log(`Searching for emergency contacts near [${coordinates}]`);
      
      // Build query
      let query = {
        location: {
          $near: {
            $geometry: {
              type: 'Point',
              coordinates: coordinates
            },
            $maxDistance: parseInt(radius) * 1000 // Convert km to meters
          }
        }
      };
      
      // Add type filter if provided
      if (type) {
        query.type = type;
      }
      
      // Find emergency contacts
      let contacts = await EmergencyContact.find(query).limit(parseInt(maxResults));
      
      // Calculate exact distances and format response
      contacts = contacts.map(contact => {
        const contactObj = contact.toObject();
        
        try {
          const directDistance = calculateDistance(
            coordinates,
            contact.location.coordinates
          );
          
          const normalizedDistance = parseFloat(directDistance.toFixed(2));
          const estimatedDistance = parseFloat((directDistance * 1.3).toFixed(2)); 
          
          return {
            ...contactObj,
            distance: {
              directDistance: normalizedDistance,
              estimatedDistance: estimatedDistance
            }
          };
        } catch (error) {
          console.error('Distance calculation error:', error);
          return {
            ...contactObj,
            distance: null,
            error: 'Failed to calculate distance'
          };
        }
      });
      
      // Sort by distance
      contacts.sort((a, b) => {
        if (!a.distance?.directDistance) return 1;
        if (!b.distance?.directDistance) return -1;
        return a.distance.directDistance - b.distance.directDistance;
      });
      
      return res.status(statusCodes.OK).json({
        success: true,
        count: contacts.length,
        data: contacts,
        searchInfo: {
          coordinates,
          radius: parseInt(radius),
          type: type || 'All types'
        }
      });
    }
    
  } catch (error) {
    console.error('Error finding nearest emergency contacts:', error);
    return res.status(statusCodes.INTERNAL_SERVER_ERROR).json({
      success: false,
      msg: 'Error finding nearest emergency contacts',
      error: error.message
    });
  }
});