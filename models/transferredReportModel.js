const mongoose = require('mongoose');

const transferredReportSchema = new mongoose.Schema({
  // Original report information (preserved for analytics)
  originalReportId: {
    type: mongoose.Schema.Types.ObjectId,
    required: [true, 'Original report ID is required']
  },
  caseId: {
    type: String,
    required: [true, 'Case ID is required']
  },
  reportType: {
    type: String,
    enum: ["Absent", "Missing", "Abducted", "Kidnapped", "Hit-and-Run"],
    required: [true, 'Report type is required']
  },

  // Person involved details (for analytics)
  personInvolved: {
    firstName: { type: String, required: true },
    lastName: { type: String, required: true },
    age: { type: Number, required: true },
    gender: { type: String, enum: ['Male', 'Female', 'Other'] }
  },

  // Original reporter information
  originalReporter: {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    name: { type: String, required: true },
    email: { type: String, required: true },
    phone: { type: String },
    isAnonymous: { type: Boolean, default: false }
  },

  // Location information (for geographic analytics)
  location: {
    city: { type: String, required: true },
    barangay: { type: String, required: true },
    streetAddress: { type: String },
    zipCode: { type: String },
    coordinates: {
      type: [Number], // [longitude, latitude]
      index: '2dsphere'
    }
  },

  // Transfer details
  transferDetails: {
    transferredBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'Transferred by user is required']
    },
    transferredTo: {
      recipientEmail: { type: String, required: true },
      recipientDepartment: { type: String, required: true },
      recipientName: { type: String }, // If provided
      recipientContact: { type: String } // If provided
    },
    transferDate: {
      type: Date,
      default: Date.now,
      required: true
    },
    transferReason: {
      type: String,
      enum: [
        'Jurisdiction Change',
        'Specialized Unit Required',
        'Resource Limitation',
        'Administrative Decision',
        'Case Complexity',
        'Inter-Agency Cooperation',
        'Other'
      ],
      default: 'Other'
    },
    transferNotes: { type: String },
    urgencyLevel: {
      type: String,
      enum: ['Low', 'Medium', 'High', 'Critical'],
      default: 'Medium'
    }
  },

  // Original assignment information
  originalAssignment: {
    policeStation: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'PoliceStation',
      required: true
    },
    policeStationName: { type: String, required: true },
    assignedOfficer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    assignedOfficerName: { type: String },
    stationCity: { type: String, required: true }
  },

  // Case timeline information
  caseTimeline: {
    reportCreatedAt: { type: Date, required: true },
    lastStatusBeforeTransfer: {
      type: String,
      enum: ["Pending", "Assigned", "Under Investigation", "Resolved"],
      required: true
    },
    daysActiveBeforeTransfer: { type: Number, required: true },
    totalFollowUps: { type: Number, default: 0 },
    statusChanges: { type: Number, default: 0 }
  },

  // Media information (for statistics)
  mediaInformation: {
    hasMainPhoto: { type: Boolean, default: false },
    additionalImagesCount: { type: Number, default: 0 },
    hasVideo: { type: Boolean, default: false },
    totalMediaFiles: { type: Number, default: 0 },
    mediaFilesTransferred: { type: Boolean, default: true }
  },

  // Transfer outcome tracking
  transferOutcome: {
    emailDeliveryStatus: {
      type: String,
      enum: ['Pending', 'Delivered', 'Failed', 'Bounced'],
      default: 'Pending'
    },
    emailDeliveredAt: { type: Date },
    recipientAcknowledged: { type: Boolean, default: false },
    acknowledgmentDate: { type: Date },
    acknowledgmentNotes: { type: String },
    followUpRequired: { type: Boolean, default: false }
  },

  // Analytics fields
  analytics: {
    transferMonth: { type: Number, required: true }, // 1-12
    transferYear: { type: Number, required: true },
    transferQuarter: { type: Number, required: true }, // 1-4
    transferDayOfWeek: { type: Number, required: true }, // 0-6 (Sunday-Saturday)
    transferHour: { type: Number, required: true }, // 0-23
    caseComplexityScore: { type: Number, min: 1, max: 10, default: 5 },
    isInterAgencyTransfer: { type: Boolean, default: true },
    isUrgentTransfer: { type: Boolean, default: false }
  },

  // System metadata
  systemMetadata: {
    transferMethodUsed: {
      type: String,
      enum: ['Email', 'System-to-System', 'Manual', 'API'],
      default: 'Email'
    },
    dataRetentionPeriod: { type: Number, default: 2555 }, // Days (7 years default)
    complianceFlags: {
      dataProtectionCompliant: { type: Boolean, default: true },
      auditTrailComplete: { type: Boolean, default: true },
      mediaSecurelyTransferred: { type: Boolean, default: true }
    },
    archivalStatus: {
      type: String,
      enum: ['Active', 'Archived', 'Purged'],
      default: 'Active'
    }
  }
}, {
  timestamps: true
});

// Indexes for analytics and reporting
transferredReportSchema.index({ 'transferDetails.transferDate': -1 });
transferredReportSchema.index({ 'analytics.transferYear': 1, 'analytics.transferMonth': 1 });
transferredReportSchema.index({ 'originalAssignment.policeStation': 1 });
transferredReportSchema.index({ 'location.city': 1 });
transferredReportSchema.index({ 'transferDetails.recipientDepartment': 1 });
transferredReportSchema.index({ reportType: 1 });
transferredReportSchema.index({ 'transferDetails.transferReason': 1 });
transferredReportSchema.index({ 'caseTimeline.daysActiveBeforeTransfer': 1 });
transferredReportSchema.index({ 'analytics.caseComplexityScore': 1 });

// Compound indexes for complex analytics
transferredReportSchema.index({ 
  'analytics.transferYear': 1, 
  'analytics.transferMonth': 1,
  'originalAssignment.policeStation': 1 
});

transferredReportSchema.index({
  'location.city': 1,
  'transferDetails.transferReason': 1,
  'reportType': 1
});

// Pre-save middleware to populate analytics fields
transferredReportSchema.pre('save', function(next) {
  if (this.isNew || this.isModified('transferDetails.transferDate')) {
    const transferDate = this.transferDetails.transferDate;
    
    this.analytics.transferMonth = transferDate.getMonth() + 1;
    this.analytics.transferYear = transferDate.getFullYear();
    this.analytics.transferQuarter = Math.ceil((transferDate.getMonth() + 1) / 3);
    this.analytics.transferDayOfWeek = transferDate.getDay();
    this.analytics.transferHour = transferDate.getHours();
    
    // Determine if urgent transfer (within 24 hours of report creation)
    const hoursDiff = (transferDate - this.caseTimeline.reportCreatedAt) / (1000 * 60 * 60);
    this.analytics.isUrgentTransfer = hoursDiff <= 24;
    
    // Calculate case complexity score based on various factors
    let complexityScore = 5; // Base score
    
    // Adjust based on case age
    if (this.caseTimeline.daysActiveBeforeTransfer > 30) complexityScore += 2;
    if (this.caseTimeline.daysActiveBeforeTransfer > 90) complexityScore += 1;
    
    // Adjust based on follow-ups
    if (this.caseTimeline.totalFollowUps > 5) complexityScore += 1;
    if (this.caseTimeline.totalFollowUps > 10) complexityScore += 1;
    
    // Adjust based on report type
    if (['Kidnapped', 'Abducted'].includes(this.reportType)) complexityScore += 2;
    if (this.reportType === 'Hit-and-Run') complexityScore += 1;
    
    // Adjust based on media files
    if (this.mediaInformation.totalMediaFiles > 5) complexityScore += 1;
    
    this.analytics.caseComplexityScore = Math.min(Math.max(complexityScore, 1), 10);
  }
  
  next();
});

// Static methods for analytics
transferredReportSchema.statics.getTransferStatsByPeriod = async function(startDate, endDate, groupBy = 'month') {
  const matchStage = {
    'transferDetails.transferDate': {
      $gte: new Date(startDate),
      $lte: new Date(endDate)
    }
  };
  
  const groupStage = groupBy === 'month' ? {
    _id: {
      year: '$analytics.transferYear',
      month: '$analytics.transferMonth'
    },
    count: { $sum: 1 },
    avgComplexity: { $avg: '$analytics.caseComplexityScore' },
    urgentTransfers: { $sum: { $cond: ['$analytics.isUrgentTransfer', 1, 0] } }
  } : {
    _id: {
      year: '$analytics.transferYear',
      quarter: '$analytics.transferQuarter'
    },
    count: { $sum: 1 },
    avgComplexity: { $avg: '$analytics.caseComplexityScore' },
    urgentTransfers: { $sum: { $cond: ['$analytics.isUrgentTransfer', 1, 0] } }
  };
  
  return this.aggregate([
    { $match: matchStage },
    { $group: groupStage },
    { $sort: { '_id.year': 1, '_id.month': 1, '_id.quarter': 1 } }
  ]);
};

transferredReportSchema.statics.getTopTransferReasons = async function(limit = 5) {
  return this.aggregate([
    {
      $group: {
        _id: '$transferDetails.transferReason',
        count: { $sum: 1 },
        avgDaysActive: { $avg: '$caseTimeline.daysActiveBeforeTransfer' }
      }
    },
    { $sort: { count: -1 } },
    { $limit: limit }
  ]);
};

transferredReportSchema.statics.getStationTransferAnalytics = async function(policeStationId) {
  return this.aggregate([
    { $match: { 'originalAssignment.policeStation': policeStationId } },
    {
      $group: {
        _id: '$transferDetails.transferReason',
        count: { $sum: 1 },
        avgComplexity: { $avg: '$analytics.caseComplexityScore' },
        totalCases: { $sum: 1 }
      }
    },
    { $sort: { count: -1 } }
  ]);
};

module.exports = mongoose.model('TransferredReport', transferredReportSchema);