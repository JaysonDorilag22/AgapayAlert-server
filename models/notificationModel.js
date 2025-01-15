const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema({
  recipient: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  type: {
    type: String,
    required: true
  },
  data: {
    reportId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Report'
    },
    finderReportId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'FinderReport'
    },
    broadcastType: String,
    scope: {
      type: {
        type: String,
        enum: ['city', 'radius', 'all']
      },
      city: String,
      radius: Number
    },
    broadcastedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    }
  },
  title: String,
  message: String,
  isRead: {
    type: Boolean,
    default: false
  }
}, {
  timestamps: true
});

notificationSchema.index({ recipient: 1, createdAt: -1 });
notificationSchema.index({ isRead: 1 });

module.exports = mongoose.model('Notification', notificationSchema);