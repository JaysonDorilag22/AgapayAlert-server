const mongoose = require('mongoose');

const messengerReportSessionSchema = new mongoose.Schema({
  psid: {
    type: String,
    required: true,
    index: true
  },
  currentStep: {
    type: String,
    enum: ['START', 'TYPE', 'PERSON_NAME', 'PERSON_AGE', 'LOCATION', 'PHOTO', 'CONFIRM'],
    default: 'START'
  },
  data: {
    type: {
      type: String,
      enum: ["Absent", "Missing", "Abducted", "Kidnapped", "Hit-and-Run"]
    },
    personInvolved: {
      firstName: String,
      lastName: String,
      age: Number,
      lastSeenDate: Date,
      lastSeenTime: String
    },
    location: {
      address: {
        streetAddress: String,
        barangay: String,
        city: String,
        zipCode: String
      }
    },
    photo: {
      url: String,
      public_id: String
    }
  },
  expiresAt: {
    type: Date,
    default: () => new Date(Date.now() + 30 * 60 * 1000) // 30 minutes from now
  }
}, { timestamps: true });

// TTL index for automatic expiry
messengerReportSessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('MessengerReportSession', messengerReportSessionSchema);