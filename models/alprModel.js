const mongoose = require('mongoose');

const alprSchema = new mongoose.Schema({
  plateNumber: {
    type: String,
    required: true,
    uppercase: true
  },
  linkedReport: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Report'
  },
  image: {
    url: String,
    public_id: String
  },
  scanResults: {
    confidence: Number,
    box: {
      xMin: Number,
      yMin: Number,
      xMax: Number,
      yMax: Number
    },
    vehicle: {
      type: { type: String },
      score: Number
    },
    region: {
      code: String,
      score: Number
    }
  },
  candidates: [{
    plate: String,
    score: Number
  }],
  source: {
    type: String,
    default: 'image'
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('ALPR', alprSchema);
// Indexes
alprSchema.index({ plateNumber: 1 });
alprSchema.index({ createdAt: -1 });
alprSchema.index({ "scanResults.confidence": -1 });

module.exports = mongoose.model('ALPR', alprSchema);