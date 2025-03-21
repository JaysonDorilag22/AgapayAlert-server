const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const UserSchema = new mongoose.Schema(
  {
    firstName: {
      type: String,
      required: [true, "First name is required"],
      trim: true,
    },
    middleName: {
      type: String,
      required: false,
    },
    lastName: {
      type: String,
      required: [true, "Last name is required"],
      trim: true,
    },
    number: {
      type: String,
      required: [true, "Phone number is required"],
      trim: true,
      unique: true,
    },
    email: {
      type: String,
      required: [true, "Email is required"],
      unique: true,
      match: [/\S+@\S+\.\S+/, "Please use a valid email address"],
    },
    password: {
      type: String,
      required: [true, "Password is required"],
      minlength: [6, "Password must be at least 6 characters long"],
    },
    deviceToken: {
      type: String,
      default: null,
    },
    roles: {
      type: [String],
      default: ["user"],
      enum: ["user", "police_officer", "police_admin", "super_admin"],
    },
    avatar: {
      url: {
        type: String,
        default: "https://cdn.pixabay.com/photo/2015/10/05/22/37/blank-profile-picture-973460_1280.png",
      },
      public_id: {
        type: String,
        default: "default_avatar",
      },
    },
    card: {
      url: {
        type: String,
        default: "https://cdn.pixabay.com/photo/2015/10/05/22/37/blank-profile-picture-973460_1280.png",
      },
      public_id: {
        type: String,
        default: "default_avatar",
      },
    },
    address: {
      streetAddress: {
        type: String,
        required: [true, "Street address is required"],
      },
      barangay: {
        type: String,
        required: [true, "Barangay is required"],
      },
      city: {
        type: String,
        required: [true, "City is required"],
      },
      zipCode: {
        type: String,
        required: [true, "ZIP code is required"],
      },
      location: {
        type: {
          type: String,
          enum: ["Point"],
          default: "Point",
        },
        coordinates: {
          type: [Number],
          default: [0, 0],
        },
      },
    },

    //POLICE OFFICER FIELDS
    policeStation: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "PoliceStation",
    },
    rank: {
      type: String,
      enum: [
        // Commissioned Officers
        "Police Colonel (PCol)",
        "Police Lieutenant Colonel (PLtCol)",
        "Police Major (PMaj)",
        "Police Captain (PCpt)",
        "Police Lieutenant (PLt)",

        // Non-Commissioned Officers
        "Police Executive Master Sergeant (PEMS)",
        "Police Chief Master Sergeant (PCMS)",
        "Police Senior Master Sergeant (PSMS)",
        "Police Master Sergeant (PMSg)",
        "Police Staff Sergeant (PSSg)",
        "Police Corporal (PCpl)",
        "Patrolman/Patrolwoman (Pat)",
      ],
    },
    isOnDuty: {
      type: Boolean,
      default: false,
    },
    dutyHistory: [
      {
        startTime: Date,
        endTime: Date,
        duration: Number,
      },
    ],
    lastDutyChange: {
      type: Date,
      default: null,
    },
    isVerified: {
      type: Boolean,
      default: false,
    },
    isAgreed: {
      type: Boolean,
      default: false,
    },
    otp: {
      type: String,
    },
    otpExpires: {
      type: Date,
    },
    resetPasswordToken: {
      type: String,
    },
    resetPasswordExpires: {
      type: Date,
    },
    messengerPSID: {
      type: String,
      unique: true,
      sparse: true,
    },
    preferredNotifications: {
      sms: {
        type: Boolean,
        default: false,
      },
      push: {
        type: Boolean,
        default: true,
      },
      email: {
        type: Boolean,
        default: false,
      },
    },
  },
  { timestamps: true }
);

UserSchema.pre("save", async function (next) {
  if (!this.isModified("password")) {
    return next();
  }
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

UserSchema.methods.updateDeviceToken = async function (token) {
  this.deviceToken = token;
  await this.save();
};

UserSchema.methods.setOtpExpiration = function () {
  this.otpExpires = Date.now() + 10 * 60 * 1000;
};

UserSchema.methods.setResetPasswordExpiration = function () {
  this.resetPasswordExpires = Date.now() + 60 * 60 * 1000;
};

UserSchema.index({ "address.location": "2dsphere" });
module.exports = mongoose.model("User", UserSchema);
