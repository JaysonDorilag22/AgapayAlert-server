const mongoose = require("mongoose");

const reportSchema = new mongoose.Schema(
  {
    // Modal 1: Basic Information (Display the user(reporter) current login for checking credentials)
    reporter: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: [true, "Reporter is required"],
    },

    // Modal 2: Choose what type of incident
    type: {
      type: String,
      enum: ["Missing", "Abducted", "Kidnapped", "Hit-and-Run"],
      required: [true, "Report type is required"],
    },
    // Modal 3: Information about the person involved in the incident (ALL REQUIRED EXCEPT ALIAS)
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
      lastKnownLocation: {
        type: String,
        required: [true, "Last known location is required"],
      },

      // Modal 4: Physical description (OPTIONAL BUT HIGHLY RECOMMENDED)
      gender: { type: String },
      race: { type: String },
      height: { type: String },
      weight: { type: String },
      eyeColor: { type: String },
      scarsMarksTattoos: { type: String },
      hairColor: { type: String },

      // Medical and identifying features (OPTIONAL BUT HIGHLY RECOMMENDED)
      birthDefects: { type: String },
      prosthetics: { type: String },
      bloodType: { type: String },
      medications: { type: String },

      lastKnownClothing: { type: String },
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

    // Modal 5: Location details (Incident location, not reporter’s location)
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

    // Modal 6: Case assignment information (Assigned police station or nearest one automatically assigned)
    assignedPoliceStation: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "PoliceStation",
      required: [true, "Assigned police station is required"],
    },

    // Case status and follow-up (For police officers only)
    status: {
      type: String,
      enum: ["Pending", "Assigned", "Under Investigation", "Resolved"],
      default: "Pending",
    },

    followUp: {
      type: String,
    },

    // Broadcasting consent (User can approve or deny)
    broadcastConsent: {
      type: Boolean,
      default: false, // Default is no consent
      required: [true, "Broadcast consent is required"],
    },

    broadcastHistory: [
      {
        date: { type: Date, default: Date.now },
        method: {
          type: String,
          enum: ["Push Notification", "Email", "Facebook Post"],
        },
      },
    ],
  },
  { timestamps: true }
);

module.exports = mongoose.model("Report", reportSchema);
