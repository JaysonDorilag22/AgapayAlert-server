const mongoose = require('mongoose');

const finderReportSchema = new mongoose.Schema(
  {
    originalReport: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Report',
      required: [true, 'Original report reference is required'],
    },
    finder: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'Finder reference is required'],
    },
    discoveryDetails: {
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
        address: {
          streetAddress: { type: String, required: true },
          barangay: { type: String, required: true },
          city: { type: String, required: true },
          zipCode: { type: String, required: true },
        }
      },
      dateAndTime: {
        type: Date,
        required: [true, 'Discovery date and time is required'],
      }
    },
    personCondition: {
      physicalCondition: { 
        type: String,
        required: true 
      },
      emotionalState: {
        type: String,
        enum: ['Calm', 'Distressed', 'Confused', 'Other'],
        required: true
      },
      notes: { type: String }
    },
    authoritiesNotified: {
      type: Boolean,
      default: false
    },
    status: {
      type: String,
      enum: ['Pending', 'Verified', 'False Report'],
      default: 'Pending'
    },
    images: [{
      url: { type: String },
      public_id: { type: String },
      uploadedAt: { type: Date, default: Date.now }
    }],
    verifiedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    }
  },
  { timestamps: true }
);

finderReportSchema.path('images').validate(function(value) {
  return value.length <= 5; 
}, 'Maximum 5 images allowed');

finderReportSchema.index({ 'discoveryDetails.location': '2dsphere' });
finderReportSchema.index({ originalReport: 1 });
finderReportSchema.index({ finder: 1 });
finderReportSchema.index({ status: 1 });
finderReportSchema.index({ createdAt: -1 });

module.exports = mongoose.model('FinderReport', finderReportSchema);