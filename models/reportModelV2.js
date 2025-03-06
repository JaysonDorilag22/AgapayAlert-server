const mongoose = require("mongoose");

// Helper function for required fields
const reqField = (type, message) => ({
  type,
  required: [true, message || "This field is required"],
});

// Person Involved Schema
const personInvolvedSchema = new mongoose.Schema(
  {
    mostRecentPhoto: {
      url: reqField(String, "Most recent photo URL is required"),
      public_id: reqField(String, "Most recent photo public ID is required"),
    },
    firstName: reqField(String, "First name is required"),
    lastName: reqField(String, "Last name is required"),
    relationship: reqField(String, "Relationship is required"),
    dateOfBirth: reqField(Date, "Date of birth is required"),
    age: reqField(Number, "Age is required"),
    lastSeenDate: reqField(Date, "Last seen date is required"),
    lastSeentime: reqField(String, "Time is required"),
    lastKnownLocation: reqField(String, "Last known location is required"),
    role: {
      type: String,
      enum: ["Suspect", "Victim", "Witness"],
      required: [true, "Role is required"],
    },

    // Optional fields
    alias: String,
    gender: String,
    race: String,
    height: String,
    weight: String,
    eyeColor: String,
    hairColor: String,
    scarsMarksTattoos: String,
    birthDefects: String,
    prosthetics: String,
    bloodType: String,
    medications: String,
    lastKnownClothing: String,
    contactInformation: String,
    otherInformation: String,
    status: {
      type: String,
      enum: ["Found", "Still Missing"],
      default: "Still Missing",
    },
  },
  { timestamps: true }
);

// Broadcast History Schema
const broadcastHistorySchema = new mongoose.Schema(
  {
    action: {
      type: String,
      enum: ["published", "unpublished"],
      required: true,
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
    targetedUsers: { type: Number, default: 0 },
    deliveryStats: {
      push: { type: Number, default: 0 },
      messenger: { type: Number, default: 0 },
      facebook: { type: Number, default: 0 },
    },
  },
  { timestamps: true }
);

// Crime Details Schema (for specific crimes)
const crimeDetailsSchema = new mongoose.Schema(
  {
    crimeType: reqField(String, "Crime type is required"),
    weaponUsed: String,
    injuryStatus: {
      type: String,
      enum: ["None", "Minor", "Severe", "Fatal"],
    },
    descriptionOfIncident: reqField(String, "Description of the incident is required"),
  },
  { _id: false }
);

// Main Report Schema
const reportSchema = new mongoose.Schema(
  {
    reporter: reqField(mongoose.Schema.Types.ObjectId, "Reporter is required"),
    type: {
      ...reqField(String, "Report type is required"),
      enum: ["Absent", "Missing", "Abducted", "Kidnapped", "Hit-and-Run", "Others"],
    },

    // For "Others" type reports
    otherReportDetails: {
      // Required fields
      title: reqField(String, "Report title is required"),
      description: reqField(String, "Report description is required"),
      category: {
        ...reqField(String, "Report category is required"),
        enum: ["Fire", "Flood", "Earthquake", "Medical Emergency", "Crime", "Accident", "Natural Disaster", "Others"],
      },
      urgencyLevel: {
        ...reqField(String, "Urgency level is required"),
        enum: ["Low", "Medium", "High", "Critical"],
        default: "Medium",
      },
      incidentDate: reqField(Date, "Incident date is required"),
      incidentTime: reqField(String, "Incident time is required"),

      // Optional counts and details
      victimCount: {
        type: Number,
        default: 0,
        min: [0, "Victim count cannot be negative"],
      },
      injuredCount: {
        type: Number,
        default: 0,
        min: [0, "Injured count cannot be negative"],
      },
      propertyDamage: {
        type: Boolean,
        default: false,
      },
      propertyDamageDetails: {
        type: String,
        required: [
          function () {
            return this.propertyDamage === true;
          },
          "Property damage details required when property damage is true",
        ],
      },

      // Witness information
      witnessCount: {
        type: Number,
        default: 0,
        min: [0, "Witness count cannot be negative"],
      },
      witnessStatements: [
        {
          name: reqField(String, "Witness name is required"),
          contact: reqField(String, "Witness contact is required"),
          statement: reqField(String, "Witness statement is required"),
          date: {
            type: Date,
            default: Date.now,
            required: true,
          },
        },
      ],

      // Additional details
      emergencyServices: {
        required: [
          {
            type: String,
            enum: ["Police", "Fire Department", "Ambulance", "Coast Guard", "Rescue Team", "Others"],
          },
        ],
      },
      actionTaken: String,
      additionalNotes: String,

      // Specific crime details
      crimeDetails: crimeDetailsSchema,
    },

    personsInvolved: [personInvolvedSchema],

    additionalImages: [
      {
        url: reqField(String, "Additional image URL is required"),
        public_id: reqField(String, "Additional image public ID is required"),
      },
    ],

    location: {
      type: { ...reqField(String, "Location type is required"), enum: ["Point"] },
      coordinates: reqField([Number], "Coordinates are required"),
      address: {
        streetAddress: reqField(String, "Street address is required"),
        barangay: reqField(String, "Barangay is required"),
        city: reqField(String, "City is required"),
        zipCode: reqField(String, "ZIP code is required"),
      },
    },

    assignedPoliceStation: reqField(mongoose.Schema.Types.ObjectId, "Assigned police station is required"),
    assignedOfficer: { type: mongoose.Schema.Types.ObjectId, ref: "User" },

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
      ...reqField(Boolean, "Broadcast consent is required"),
      default: false,
    },

    isPublished: { type: Boolean, default: false },

    consentUpdateHistory: [
      {
        date: { type: Date, default: Date.now },
        previousValue: Boolean,
        newValue: Boolean,
        updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
      },
    ],

    // Broadcast history as separate collection
    broadcastHistory: [broadcastHistorySchema],
  },
  { timestamps: true }
);

// Indexes
reportSchema.index({ type: 1 });
reportSchema.index({ "otherReportDetails.urgencyLevel": 1 });
reportSchema.index({ "otherReportDetails.incidentDate": -1 });
reportSchema.index({ "location.address.city": 1 });
reportSchema.index({ broadcastConsent: 1 });
reportSchema.index({ isPublished: 1 });
reportSchema.index({ createdAt: -1 });
reportSchema.index({ location: "2dsphere" });
reportSchema.index({ "personsInvolved.status": 1 });

module.exports = mongoose.model("Report", reportSchema);
