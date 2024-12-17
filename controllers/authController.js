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

// Register a new user
exports.register = asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(statusCodes.BAD_REQUEST).json({ errors: errors.array() });
  }

  const { firstName, lastName, number, email, password, address } = req.body;
  const file = req.file; // Assuming you're using multer to handle file uploads

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
  });

  // Save user to database
  await user.save();

  // Generate OTP and send email
  const otp = crypto.randomBytes(3).toString('hex');
  user.otp = otp;
  user.setOtpExpiration();
  await user.save();

  // Create mail options
  const mailOptions = createMailOptions(user.email, 'Verify your email', 'otpEmail.ejs', { otp });

  // Send OTP email
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

// Login user
exports.login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;

  const user = await User.findOne({ email });

  if (!user) {
    return res.status(statusCodes.BAD_REQUEST).json({ msg: errorMessages.USER_NOT_FOUND });
  }

  const isMatch = await bcrypt.compare(password, user.password);

  if (!isMatch) {
    return res.status(statusCodes.BAD_REQUEST).json({ msg: errorMessages.INVALID_CREDENTIALS });
  }

  if (!user.isVerified) {
    return res.status(statusCodes.BAD_REQUEST).json({ msg: errorMessages.EMAIL_NOT_VERIFIED });
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

// Logout user
exports.logout = (req, res) => {
  res.clearCookie('token');
  res.status(statusCodes.OK).json({ msg: 'Logged out successfully' });
};


// Forgot password
exports.forgotPassword = asyncHandler(async (req, res) => {
  const { email } = req.body;

  const user = await User.findOne({ email });

  if (!user) {
    return res.status(statusCodes.BAD_REQUEST).json({ msg: errorMessages.USER_NOT_FOUND });
  }

  // Generate OTP and send email
  const otp = crypto.randomBytes(3).toString('hex');
  user.otp = otp;
  user.setOtpExpiration();
  await user.save();

  // Create mail options
  const mailOptions = createMailOptions(user.email, 'Password Reset', 'otpEmail.ejs', { otp });

  // Send OTP email
  await sendEmail(mailOptions);

  res.status(statusCodes.OK).json({ msg: 'Password reset OTP sent' });
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