const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const UserSchema = new mongoose.Schema(
  {
    firstName: {
      type: String,
      required: [true, 'First name is required'],
      trim: true,
    },
    lastName: {
      type: String,
      required: [true, 'Last name is required'],
      trim: true,
    },
    number: {
      type: String,
      required: [true, 'Phone number is required'],
      trim: true,
    },
    email: {
      type: String,
      required: [true, 'Email is required'],
      unique: true,
      match: [/\S+@\S+\.\S+/, 'Please use a valid email address'],
    },
    password: {
      type: String,
      required: [true, 'Password is required'],
      minlength: [6, 'Password must be at least 6 characters long'],
    },
    roles: {
      type: [String],
      default: ['user'],
      enum: ['user', 'police_officer', 'police_admin', 'city_admin', 'super_admin'],
    },
    avatar: {
      url: {
        type: String,
        default: 'https://cdn.pixabay.com/photo/2015/10/05/22/37/blank-profile-picture-973460_1280.png',
      },
      public_id: {
        type: String,
        default: 'default_avatar',
      },
    },
    address: {
      streetAddress: {
        type: String,
        required: [true, 'Street address is required'],
      },
      barangay: {
        type: String,
        required: [true, 'Barangay is required'],
      },
      city: {
        type: String,
        required: [true, 'City is required'],
      },
      province: {
        type: String,
        required: [true, 'Province is required'],
      },
      zipCode: {
        type: String,
        required: [true, 'ZIP code is required'],
      },
    },
    isVerified: {
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

// Hash the password before saving the user
UserSchema.pre('save', async function (next) {
  if (!this.isModified('password')) {
    return next();
  }
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

// Set standard expiration times for OTP and password reset tokens
UserSchema.methods.setOtpExpiration = function () {
  this.otpExpires = Date.now() + 10 * 60 * 1000; // 10 minutes
};

UserSchema.methods.setResetPasswordExpiration = function () {
  this.resetPasswordExpires = Date.now() + 60 * 60 * 1000; // 1 hour
};

module.exports = mongoose.model('User', UserSchema);
