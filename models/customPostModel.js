const mongoose = require('mongoose');

const customPostSchema = new mongoose.Schema({
  author: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'Author is required']
  },
  title: {
    type: String,
    required: [true, 'Post title is required'],
    trim: true,
    maxLength: [100, 'Title cannot exceed 100 characters']
  },
  content: {
    type: String,
    required: [true, 'Post content is required'],
    trim: true,
    maxLength: [2000, 'Content cannot exceed 2000 characters']
  },
  category: {
    type: String,
    enum: ['Safety Alert', 'Community Update', 'Public Service', 'Event Announcement', 'Emergency Notice', 'General'],
    default: 'General'
  },
  priority: {
    type: String,
    enum: ['Low', 'Medium', 'High', 'Urgent'],
    default: 'Medium'
  },
  targetAudience: {
    type: String,
    enum: ['General Public', 'Local Community', 'Police Officers', 'City Officials', 'All'],
    default: 'General Public'
  },
  media: [{
    type: {
      type: String,
      enum: ['image', 'video'],
      required: true
    },
    url: {
      type: String,
      required: true
    },
    public_id: {
      type: String,
      required: true
    },
    caption: String
  }],
  tags: [{
    type: String,
    trim: true
  }],
  status: {
    type: String,
    enum: ['Draft', 'Pending Approval', 'Published', 'Archived'],
    default: 'Draft'
  },
  approvedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  approvalDate: Date,
  publishedDate: Date,
  facebookPostId: String,
  publishingDetails: {
    platforms: [{
      type: String,
      enum: ['Facebook', 'Messenger'],
      default: 'Facebook'
    }],
    reach: {
      type: Number,
      default: 0
    },
    engagement: {
      likes: { type: Number, default: 0 },
      comments: { type: Number, default: 0 },
      shares: { type: Number, default: 0 }
    },
    errorLog: String,
    messengerBroadcastStats: {
      sentCount: { type: Number, default: 0 },
      deliveredCount: { type: Number, default: 0 },
      failedCount: { type: Number, default: 0 }
    }
  },
  scheduledDate: Date,
  isScheduled: {
    type: Boolean,
    default: false
  },
  policeStation: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'PoliceStation'
  },
  city: String,
  visibility: {
    type: String,
    enum: ['Public', 'Station Only', 'City Only'],
    default: 'Public'
  }
}, {
  timestamps: true
});

// Indexes for efficient queries
customPostSchema.index({ author: 1, createdAt: -1 });
customPostSchema.index({ status: 1, createdAt: -1 });
customPostSchema.index({ category: 1, priority: -1 });
customPostSchema.index({ policeStation: 1, status: 1 });
customPostSchema.index({ city: 1, status: 1 });
customPostSchema.index({ scheduledDate: 1, isScheduled: 1 });

// Virtual for formatted content
customPostSchema.virtual('formattedContent').get(function() {
  let formatted = `${this.title}\n\n${this.content}`;
  
  if (this.tags && this.tags.length > 0) {
    formatted += `\n\n${this.tags.map(tag => `#${tag.replace(/\s+/g, '')}`).join(' ')}`;
  }
  
  return formatted;
});

// Pre-save middleware
customPostSchema.pre('save', function(next) {
  if (this.status === 'Published' && !this.publishedDate) {
    this.publishedDate = new Date();
  }
  next();
});

module.exports = mongoose.model('CustomPost', customPostSchema);