const User = require('../models/userModel');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { validationResult } = require('express-validator');
const sendEmail = require('../utils/sendEmail');
const generateToken = require('../utils/generateToken');
const createMailOptions = require('../utils/createMailOptions');
const asyncHandler = require('express-async-handler');
const dotenv = require('dotenv');
const errorMessages = require('../constants/errorMessages');
const statusCodes = require('../constants/statusCodes');
const roles = require('../constants/roles');
const uploadToCloudinary = require('../utils/uploadToCloudinary');

dotenv.config();


// Google Auth
exports.googleAuth = asyncHandler(async (req, res) => {
  const { email, firstName, lastName, avatar, deviceToken } = req.body;

  try {
    let user = await User.findOne({ email });

    if (user) {
      // Update device token if provided
      if (deviceToken) {
        user.deviceToken = deviceToken;
        await user.save();
      }

      const payload = {
        user: {
          id: user._id,
          roles: user.roles,
        },
      };
      const token = generateToken(payload, res);
      return res.json({ exists: true, user, token });
    } else {
      return res.json({
        exists: false,
        user: {
          email,
          firstName,
          lastName,
          avatar,
          deviceToken
        },
      });
    }
  } catch (error) {
    console.error('Error checking user:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Register
// Register with device token
exports.register = asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(statusCodes.BAD_REQUEST).json({ errors: errors.array() });
  }

  const { firstName, lastName, number, email, password, address, deviceToken } = req.body;
  const file = req.file;

  if (!file) {
    return res.status(statusCodes.BAD_REQUEST).json({ msg: errorMessages.AVATAR_REQUIRED });
  }

  let user = await User.findOne({ email });
  if (user) {
    return res.status(statusCodes.CONFLICT).json({ msg: errorMessages.USER_ALREADY_EXISTS });
  }

  const uploadResult = await uploadToCloudinary(file.path, 'avatars');
  const avatar = {
    url: uploadResult.url,
    public_id: uploadResult.public_id,
  };

  user = new User({
    firstName,
    lastName,
    number,
    email,
    password,
    address,
    avatar,
    deviceToken,
    preferredNotifications: {
      push: true,
      email: false,
      sms: false
    }
  });

  await user.save();

  const otp = crypto.randomBytes(3).toString('hex');
  user.otp = otp;
  user.setOtpExpiration();
  await user.save();

  const mailOptions = createMailOptions(user.email, 'Verify your email', 'otpEmail.ejs', { otp });
  await sendEmail(mailOptions);

  res.status(statusCodes.CREATED).json({ msg: 'User registered, please verify your email' });
});

// Verify account
exports.verifyAccount = asyncHandler(async (req, res) => {
  const { email, otp } = req.body;

  const user = await User.findOne({ email });

  if (!user) {
    return res.status(statusCodes.BAD_REQUEST).json({ msg: errorMessages.INVALID_EMAIL_OR_OTP });
  }

  if (user.otp !== otp || user.otpExpires < Date.now()) {
    return res.status(statusCodes.BAD_REQUEST).json({ msg: errorMessages.INVALID_OR_EXPIRED_OTP });
  }

  user.isVerified = true;
  user.otp = undefined;
  user.otpExpires = undefined;
  await user.save();

  res.status(statusCodes.OK).json({ msg: 'Email verified successfully' });
});

// Resend verification email
exports.resendVerification = asyncHandler(async (req, res) => {
  const { email } = req.body;

  const user = await User.findOne({ email });

  if (!user) {
    return res.status(statusCodes.BAD_REQUEST).json({ msg: errorMessages.USER_NOT_FOUND });
  }

  if (user.isVerified) {
    return res.status(statusCodes.BAD_REQUEST).json({ msg: 'Email is already verified' });
  }

  const otp = crypto.randomBytes(3).toString('hex');
  user.otp = otp;
  user.setOtpExpiration();
  await user.save();

  const mailOptions = createMailOptions(user.email, 'Verify your email', 'otpEmail.ejs', { otp });

  await sendEmail(mailOptions);

  res.status(statusCodes.OK).json({ msg: 'Verification email resent' });
});

// Login with device token
exports.login = asyncHandler(async (req, res) => {
  const { email, password, deviceToken } = req.body;

  const user = await User.findOne({ email });

  if (!user) {
    return res.status(statusCodes.BAD_REQUEST).json({ msg: errorMessages.USER_NOT_FOUND });
  }

  const isMatch = await bcrypt.compare(password, user.password);

  if (!isMatch) {
    return res.status(statusCodes.BAD_REQUEST).json({ msg: errorMessages.INVALID_CREDENTIALS });
  }

  if (!user.isVerified) {
    const otp = crypto.randomBytes(3).toString('hex');
    user.otp = otp;
    user.setOtpExpiration();
    await user.save();

    const mailOptions = createMailOptions(user.email, 'Verify your email', 'otpEmail.ejs', { otp });
    await sendEmail(mailOptions);

    return res.status(statusCodes.BAD_REQUEST).json({ 
      msg: errorMessages.EMAIL_NOT_VERIFIED,
      verificationSent: true 
    });
  }

  // Update device token if provided
  if (deviceToken) {
    user.deviceToken = deviceToken;
    await user.save();
  }

  const payload = {
    user: {
      id: user.id,
      roles: user.roles,
    },
  };
  generateToken(payload, res);

  res.json({ msg: 'Logged in successfully', user });
});

// Logout and clear device token
// Logout and clear device token
exports.logout = asyncHandler(async (req, res) => {
  try {
    // Only clear device token if user is authenticated
    if (req.user && req.user.id) {
      await User.findByIdAndUpdate(req.user.id, {
        deviceToken: null
      });
    }

    // Clear the cookie regardless of user state
    res.clearCookie('token', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'Lax',
      path: '/'
    });

    res.status(statusCodes.OK).json({ 
      success: true,
      msg: 'Logged out successfully', 
      tokenCleared: true 
    });
  } catch (error) {
    console.error('Logout error:', error);
    res.status(statusCodes.INTERNAL_SERVER_ERROR).json({
      success: false,
      msg: 'Error during logout',
      error: error.message
    });
  }
});

// Forgot password
exports.forgotPassword = asyncHandler(async (req, res) => {
  const { email } = req.body;

  const user = await User.findOne({ email });

  if (!user) {
    return res.status(statusCodes.BAD_REQUEST).json({ msg: errorMessages.USER_NOT_FOUND });
  }

  const otp = crypto.randomBytes(3).toString('hex');
  user.otp = otp;
  user.setOtpExpiration();
  await user.save();

  const mailOptions = createMailOptions(user.email, 'Password Reset', 'otpEmail.ejs', { otp });

  await sendEmail(mailOptions);

  res.status(statusCodes.OK).json({ msg: 'Password reset OTP sent' });
});

// Resend OTP for forgot password
exports.resendForgotPasswordOTP = asyncHandler(async (req, res) => {
  const { email } = req.body;

  const user = await User.findOne({ email });

  if (!user) {
    return res.status(statusCodes.BAD_REQUEST).json({ msg: errorMessages.USER_NOT_FOUND });
  }

  const otp = crypto.randomBytes(3).toString('hex');
  user.otp = otp;
  user.setOtpExpiration();
  await user.save();

  const mailOptions = createMailOptions(user.email, 'Password Reset', 'otpEmail.ejs', { otp });

  await sendEmail(mailOptions);

  res.status(statusCodes.OK).json({ msg: 'OTP resent for password reset' });
});

// Reset password
exports.resetPassword = asyncHandler(async (req, res) => {
  const { email, otp, newPassword } = req.body;

  const user = await User.findOne({ email });

  if (!user) {
    return res.status(statusCodes.BAD_REQUEST).json({ msg: errorMessages.INVALID_EMAIL_OR_OTP });
  }

  if (user.otp !== otp || user.otpExpires < Date.now()) {
    return res.status(statusCodes.BAD_REQUEST).json({ msg: errorMessages.INVALID_OR_EXPIRED_OTP });
  }

  user.password = newPassword;
  user.otp = undefined;
  user.otpExpires = undefined;
  await user.save();

  res.status(statusCodes.OK).json({ msg: 'Password reset successfully' });
});


exports.updateDeviceToken = asyncHandler(async (req, res) => {
  const { deviceToken } = req.body;
  
  const user = await User.findByIdAndUpdate(
    req.user.id, 
    {
      deviceToken,
      'preferredNotifications.push': true
    },
    { new: true }
  );

  if (!user) {
    return res.status(statusCodes.NOT_FOUND).json({
      success: false,
      message: 'User not found'
    });
  }

  res.status(statusCodes.OK).json({
    success: true,
    message: 'Device token updated successfully',
    preferredNotifications: user.preferredNotifications
  });
});