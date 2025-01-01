const axios = require('axios');

async function getCoordinatesFromAddress(address) {
  try {
    // Validate address object
    const requiredFields = ['streetAddress', 'barangay', 'city', 'zipCode'];
    for (const field of requiredFields) {
      if (!address[field]) {
        return {
          success: false,
          message: `Missing required field: ${field}`,
          coordinates: null
        };
      }
    }

    // Build structured parameters
    const params = new URLSearchParams({
      format: 'json',
      street: address.streetAddress,
      city: `${address.barangay}, ${address.city}`,
      postalcode: address.zipCode,
      country: 'PH'
    });

    // Make API request
    const url = `https://nominatim.openstreetmap.org/search?${params.toString()}`;
    console.log('Geocoding request:', url);
    
    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'AgapayAlert/1.0'
      }
    });

    if (response.data && response.data.length > 0) {
      const coordinates = [
        parseFloat(response.data[0].lon),
        parseFloat(response.data[0].lat)
      ];

      return {
        success: true,
        coordinates,
        displayName: response.data[0].display_name,
        addressUsed: `${address.streetAddress}, ${address.barangay}, ${address.city}, ${address.zipCode}`
      };
    }

    return {
      success: false,
      message: 'No coordinates found for this address',
      coordinates: null
    };

  } catch (error) {
    console.error('Geocoding error:', error.message);
    return {
      success: false,
      message: error.message,
      coordinates: null
    };
  }
}

module.exports = {
  getCoordinatesFromAddress
};