const mongoose = require("mongoose");

const reportSchema = new mongoose.Schema(
  {
    reporter: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: [true, "Reporter is required"],
    },
    caseId: {
      type: String,
      unique: true
    },
    type: {
      type: String,
      enum: ["Absent", "Missing", "Abducted", "Kidnapped", "Hit-and-Run"],
      required: [true, "Report type is required"],
    },
    personInvolved: {
      mostRecentPhoto: {
        url: {
          type: String,
          required: [true, "Most recent photo URL is required"],
        },
        public_id: {
          type: String,
          required: [true, "Most recent photo public ID is required"],
        },
      },

      firstName: { type: String, required: [true, "First name is required"] },
      lastName: { type: String, required: [true, "Last name is required"] },
      alias: { type: String },
      relationship: {
        type: String,
        required: [true, "Relationship is required"],
      },
      dateOfBirth: {
        type: Date,
        required: [true, "Date of birth is required"],
      },
      age: {
        type: Number,
        required: [true, "Age is required"],
      },
      lastSeenDate: {
        type: Date,
        required: [true, "Last seen date is required"],
      },
      lastSeentime: {
        type: String,
        required: [true, "Time is required"],
      },
      lastKnownLocation: {
        type: String,
        required: [true, "Last known location is required"],
      },

      gender: { type: String },
      race: { type: String },
      height: { type: String },
      weight: { type: String },
      eyeColor: { type: String },
      scarsMarksTattoos: { type: String },
      hairColor: { type: String },
      birthDefects: { type: String },
      prosthetics: { type: String },
      bloodType: { type: String },
      medications: { type: String },
      lastKnownClothing: { type: String },
      rewards: { type: String },
      contactInformation: { type: String },
      otherInformation: { type: String },
    },

    additionalImages: [
      {
        url: {
          type: String,
          required: [true, "Additional image URL is required"],
        },
        public_id: {
          type: String,
          required: [true, "Additional image public ID is required"],
        },
      },
    ],

    video: {
      url: {
        type: String,
      },
      public_id: {
        type: String,
      }
    },

    location: {
      type: {
        type: String,
        enum: ["Point"],
        required: [true, "Location type is required"],
      },
      coordinates: {
        type: [Number],
        required: [true, "Coordinates are required"],
      },
      address: {
        streetAddress: {
          type: String,
          required: [true, "Street address is required"],
        },
        barangay: { type: String, required: [true, "Barangay is required"] },
        city: { type: String, required: [true, "City is required"] },
        zipCode: { type: String, required: [true, "ZIP code is required"] },
      },
    },

    assignedPoliceStation: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "PoliceStation",
      required: [true, "Assigned police station is required"],
    },

    assignedOfficer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },

    status: {
      type: String,
      enum: ["Pending", "Assigned", "Under Investigation", "Resolved"],
      default: "Pending",
    },

    followUp: [
      {
        note: String,
        updatedAt: Date,
      },
    ],

    broadcastConsent: {
      type: Boolean,
      default: false,
      required: [true, "Broadcast consent is required"],
    },

    isPublished: {
      type: Boolean,
      default: false,
    },

    consentUpdateHistory: [
      {
        date: {
          type: Date,
          default: Date.now,
        },
        previousValue: Boolean,
        newValue: Boolean,
        updatedBy: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "User",
        },
      },
    ],

    broadcastHistory: [
      {
        date: {
          type: Date,
          default: Date.now,
        },
        action: {
          type: String,
          enum: ["published", "unpublished"],
        },
        method: [
          {
            type: String,
            enum: ["Push Notification", "Messenger", "Facebook Post"],
          },
        ],
        publishedBy: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "User",
        },
        facebookPostId: String,
        notes: String,
        scope: {
          type: {
            type: String,
            enum: ["city", "radius", "all"],
          },
          city: String,
          radius: Number,
        },
        targetedUsers: Number,
        deliveryStats: {
          push: Number,
          messenger: Number,
          facebook: Number,
        },
      },
    ],
  },
  { timestamps: true }
);

// Pre-save middleware to generate caseId
reportSchema.pre('save', async function(next) {
  if (!this.caseId) {
    const prefix = this.type.substring(0, 3).toUpperCase();
    const idSuffix = this._id.toString().slice(-7);
    this.caseId = `${prefix}-${idSuffix}`;
  }
  next();
});

reportSchema.index({ "location.address.city": 1 });
reportSchema.index({ broadcastConsent: 1 });
reportSchema.index({ isPublished: 1 });
reportSchema.index({ createdAt: -1 });
reportSchema.index({ caseId: 1 }, { unique: true });



module.exports = mongoose.model("Report", reportSchema);
