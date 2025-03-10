const mongoose = require('mongoose');

const emergencyContactSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Emergency service name is required'],
    trim: true
  },
  type: {
    type: String,
    required: [true, 'Service type is required'],
    enum: [
      'Fire Station',
      'Hospital',
      'Police Station',
      'Ambulance',
      'Coast Guard',
      'Disaster Response',
      'Red Cross',
      'Other'
    ]
  },
  contactNumbers: [{
    number: {
      type: String,
      required: [true, 'Contact number is required'],
      trim: true
    },
    isActive: {
      type: Boolean,
      default: true
    }
  }],
  address: {
    streetAddress: {
      type: String,
      required: [true, 'Street address is required']
    },
    barangay: {
      type: String,
      required: [true, 'Barangay is required']
    },
    city: {
      type: String,
      required: [true, 'City is required']
    },
    zipCode: {
      type: String,
      required: [true, 'ZIP code is required']
    }
  },
  location: {
    type: {
      type: String,
      enum: ['Point'],
      required: true
    },
    coordinates: {
      type: [Number],
      required: true
    }
  }
}, {
  timestamps: true
});

// Index for geospatial queries
emergencyContactSchema.index({ location: '2dsphere' });
// Index for city-based queries
emergencyContactSchema.index({ 'address.city': 1 });
// Index for type-based queries
emergencyContactSchema.index({ type: 1 });

const EmergencyContact = mongoose.model('EmergencyContact', emergencyContactSchema);

module.exports = EmergencyContact;