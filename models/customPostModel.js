const mongoose = require('mongoose');

const customPostSchema = new mongoose.Schema({
  author: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'Author is required']
  },
  caption: {
    type: String,
    required: [true, 'Caption is required'],
    trim: true,
    maxLength: [500, 'Caption cannot exceed 500 characters']
  },
  images: [{
    url: {
      type: String,
      required: true
    },
    public_id: {
      type: String,
      required: true
    }
  }],
  policeStation: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'PoliceStation'
  },
  status: {
    type: String,
    enum: ['Draft', 'Published'],
    default: 'Draft'
  }
}, {
  timestamps: true
});

// Simple indexes for basic querying
customPostSchema.index({ author: 1, createdAt: -1 });
customPostSchema.index({ policeStation: 1, createdAt: -1 });
customPostSchema.index({ status: 1, createdAt: -1 });

module.exports = mongoose.model('CustomPost', customPostSchema);