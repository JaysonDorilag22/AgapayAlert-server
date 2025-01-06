const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema({
  recipient: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  type: {
    type: String,
    enum: ['REPORT_CREATED', 'STATUS_UPDATED', 'ASSIGNED_OFFICER', 'FINDER_REPORT'],
    required: true
  },
  title: {
    type: String,
    required: true
  },
  message: String,
  data: {
    reportId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Report'
    },
    finderReportId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'FinderReport'
    }
  },
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