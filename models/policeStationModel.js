const mongoose = require('mongoose');

const policeStationSchema = new mongoose.Schema({
  name: { type: String, required: true },
  city: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'City',
    required: [true, 'City is required'],
  },
  location: {
    type: {
      type: String,
      enum: ['Point'],
      required: true,
    },
    coordinates: {
      type: [Number],
      required: true,
    },
  },
  address: {
    streetAddress: {
      type: String,
      required: [true, 'Street address is required'],
    },
    barangay: {
      type: String,
      required: [true, 'Barangay is required'],
    },
    city: {
      type: String,
      required: [true, 'City is required'],
    },
    zipCode: {
      type: String,
      required: [true, 'ZIP code is required'],
    },
  },
  image: {
    url: {
      type: String,
      required: true,
    },
    public_id: {
      type: String,
      required: true,
    },
  },
});

policeStationSchema.index({ location: '2dsphere' });

module.exports = mongoose.model('PoliceStation', policeStationSchema);