const mongoose = require('mongoose');

const reportSchema = new mongoose.Schema(
  {
    // Modal 1 : Basic Information (Display the  user(reporter) Current login)
    reporter: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User', 
      required: [true, 'Reporter is required'],
    },

    //Modal 2 
    //Basic information
    type: {
      type: String,
      enum: ['Missing', 'Abducted', 'Kidnapped', 'Hit-and-Run'],
      required: [true, 'Report type is required'],
    },

    // Report Details and initial images (images only optiona;. If the user pick the type, the subject and description will be auto filled, subject is same as type and the description (meaning of that type)) 
    details: {
      subject: { type: String, required: [true, 'Subject is required'] }, 
      description: { type: String, required: [true, 'Description is required'] }, 
      images: [
        {
          url: { type: String }, 
          public_id: { type: String }, 
        },
      ],
    },

    // Modal 3 : Information about the person involved in the incident
    personInvolved: {
       // Basic personal information (ALL REQUIRED EXEPT THE ALIAS)
      firstName: { type: String, required: [true, 'First name is required'] },
      lastName: { type: String, required: [true, 'Last name is required'] },
      alias: { type: String },
      relationship: { type: String, required: [true, 'Relationship is required'] },
      dateOfBirth: { type: Date, required: [true, 'Date of birth is required'] },
      lastKnownLocation: { type: String, required: [true, 'Last known location is required'] },
      mostRecentPhoto: {
        url: { type: String, required: [true, 'Most recent photo URL is required'] }, 
        public_id: { type: String, required: [true, 'Most recent photo public ID is required'] },
      },

    // Modal 3 : Physical description (OPTIONAL BUT HIGH RECOMMENDED TO FILL UP)
      gender: { type: String },
      race: { type: String },
      height: { type: String },
      weight: { type: String },
      eyeColor: { type: String },
      scarsMarksTattoos: { type: String },
      hairColor: { type: String },

      // Identifying features and medical information (OPTIONAL BUT HIGHLY RECOMMENDED TO FILL UP)
      birthDefects: { type: String },
      prosthetics: { type: String },
      bloodType: { type: String },
      medications: { type: String },

      // Additional information
      lastKnownClothing: { type: String },
      contactInformation: { type: String },
      otherInformation: { type: String },
    },

     // Modal 4: Location information (WHERE THE INCIDENT HAPPENED OR LAST SCENE)
     location: {
      type: {
        type: String,
        enum: ['Point'],
        required: [true, 'Location type is required'],
      },
      coordinates: { type: [Number], required: [true, 'Coordinates are required'] }, 
      address: {
        streetAddress: { type: String, required: [true, 'Street address is required'] },
        barangay: { type: String, required: [true, 'Barangay is required'] },
        city: { type: String, required: [true, 'City is required'] },
        zipCode: { type: String, required: [true, 'ZIP code is required'] },
      },
    },

    // Date and time of incident (WHEN THE INCIDENT HAPPENED OR LAST SCENE)
    dateTime: {
      date: { type: String, required: [true, 'Date is required'] },
      time: { type: String, required: [true, 'Time is required'] },
    },

    // Modal 5: Case assignment information they can choose police station or the system will automatically assign the nearest police station NOTE: OFFICER IS NOT VISIBLE TO THE USER
    assignedPoliceStation: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'PoliceStation', 
      required: [true, 'Assigned police station is required'],
    },
    assignedOfficer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User', 
    },

    // Modal 6 : Preview of the information with submit button

    //NO MODAL FOR THIS ---------------------------------------------------

    // Case status and follow-up, this for the police officer only so no need to the modal
    status: {
      type: String,
      enum: ['Pending', 'Assigned', 'Under Investigation', 'Resolved'],
      default: 'Pending',
    },
    additionalImages: [
      {
        url: { type: String, required: [true, 'Additional image URL is required'] },
        public_id: { type: String, required: [true, 'Additional image public ID is required'] }, 
      },
    ],
    followUp: {
      type: String, 
    },
     // Broadcasting information
     broadcastConsent: {
      type: Boolean,
      default: false,
    },
    consentUpdateHistory: [{
      updatedAt: {
        type: Date,
        default: Date.now
      },
      previousValue: {
        type: Boolean
      },
      newValue: {
        type: Boolean
      }
    }],
    hasUpdatedConsent: {
      type: Boolean,
      default: false
    },

    broadcastHistory: [
      {
        date: { type: Date, default: Date.now },
        method: { type: String, enum: ['Push Notification', 'Email', 'Facebook Post'] },
      },
    ],
  },
  { timestamps: true }
);

module.exports = mongoose.model('Report', reportSchema);