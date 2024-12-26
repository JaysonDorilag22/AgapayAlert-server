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
// Google Auth
exports.googleAuth = asyncHandler(async (req, res) => {
  const { email, firstName, lastName, avatar } = req.body;

  try {
    let user = await User.findOne({ email });

    if (user) {
      // User exists, log in the user
      const payload = {
        user: {
          id: user._id,
          roles: user.roles,
        },
      };
      const token = generateToken(payload, res);
      console.log(token)
      return res.json({ exists: true, user, token });
    } else {
      // User does not exist, return Google information for registration
      return res.json({
        exists: false,
        user: {
          email,
          firstName,
          lastName,
          avatar,
        },
      });
    }
  } catch (error) {
    console.error('Error checking user:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Register
exports.register = asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(statusCodes.BAD_REQUEST).json({ errors: errors.array() });
  }

  const { firstName, lastName, number, email, password, address } = req.body;
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
  // Log the current cookies before clearing
  console.log('Cookies before clearing:', req.cookies);

  res.clearCookie('token', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
  });

  // Log a message indicating the token has been cleared
  console.log('Token cleared successfully');

  res.status(statusCodes.OK).json({ msg: 'Logged out successfully', tokenCleared: true });
};

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