const mongoose  = require("mongoose");

const reportSchema = new mongoose.Schema(
    {
      reporter: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User", // User who reported the case
        required: true,
      },
      type: {
        type: String,
        enum: ["Missing", "Abducted", "Kidnapped", "Hit-and-Run"],
        required: true,
      },
      details: {
        subject: { type: String, required: true }, // Brief title or subject of the report
        description: { type: String, required: true }, // Detailed description
        images: [
          {
            url: { type: String, required: true }, // Cloud-hosted image URL
            public_id: { type: String, required: true }, // Public ID for cloud management
          },
        ],
      },
      personInvolved: {
        name: { type: String, required: true },
        alias: { type: String },
        dateOfBirth: { type: Date },
        gender: { type: String },
        race: { type: String },
        height: { type: String },
        weight: { type: String },
        scarsMarksTattoos: { type: String },
        lastKnownClothing: { type: String },
        lastKnownLocation: { type: String, required: true },
        mostRecentPhoto:  {
          url: { type: String, required: true }, // Cloud-hosted image URL
          public_id: { type: String, required: true }, // Public ID for cloud management
        },
      },
      assignedPoliceStation: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "PoliceStation", // Refers to the station handling the report
        required: true,
      },
      assignedOfficer: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User", // Officer assigned to the case
      },
      location: {
        type: {
          type: String,
          enum: ['Point'],
          required: true,
        },
        coordinates: { type: [Number], required: true }, // [longitude, latitude]
        address: {
          streetAddress: { type: String, required: true },
          barangay: { type: String, required: true },
          city: { type: String, required: true },
          province: { type: String, required: true },
          zipCode: { type: String, required: true },
        },
      },
      dateTime: {
        date: { type: String, required: true },
        time: { type: String, required: true },
      },
      status: {
        type: String,
        enum: ["Pending", "Assigned", "Under Investigation", "Resolved"],
        default: "Pending",
      },
      additionalImages: [
        {
          url: { type: String, required: true }, // Cloud-hosted image URL
          public_id: { type: String, required: true }, // Public ID for cloud management
        },
      ],
      followUp: {
        type: String, // Follow-up notes or additional information
      },
    },
    { timestamps: true }
  );

module.exports = mongoose.model("Report", reportSchema);