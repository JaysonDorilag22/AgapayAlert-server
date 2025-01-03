const axios = require('axios');

async function getCoordinatesFromAddress(address) {
  try {
    // Try different combinations of address components
    const addressCombinations = [
      // Full address
      {
        street: address.streetAddress,
        city: `${address.barangay}, ${address.city}`,
        postalcode: address.zipCode,
      },
      // Without street
      {
        city: `${address.barangay}, ${address.city}`,
        postalcode: address.zipCode,
      },
      // Just city and barangay
      {
        city: `${address.barangay}, ${address.city}`,
      },
      // City only
      {
        city: address.city,
      }
    ];

    // Try each combination until we get coordinates
    for (const addressParts of addressCombinations) {
      const params = new URLSearchParams({
        format: 'json',
        country: 'PH',
        ...addressParts
      });

      const url = `https://nominatim.openstreetmap.org/search?${params.toString()}`;
      console.log('Trying geocoding with:', url);
      
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
          addressUsed: Object.values(addressParts).join(', ')
        };
      }
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