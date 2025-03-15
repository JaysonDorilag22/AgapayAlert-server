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
const axios = require('axios');
dotenv.config();


// Google Auth
exports.googleAuth = asyncHandler(async (req, res) => {
  const { email, firstName, lastName, avatar, deviceToken } = req.body;

  try {
    let user = await User.findOne({ email });

    if (user) {
      // Update device token and OneSignal tags if provided
      if (deviceToken) {
        try {
          // Update OneSignal player tags
          await axios.put(
            `https://onesignal.com/api/v1/players/${deviceToken}`,
            {
              app_id: process.env.ONESIGNAL_APP_ID,
              tags: {
                role: user.roles[0],
                userId: user._id.toString()
              }
            },
            {
              headers: {
                'Authorization': `Basic ${process.env.ONESIGNAL_API_KEY}`,
                'Content-Type': 'application/json'
              }
            }
          );

          user.deviceToken = deviceToken;
          await user.save();
          console.log('Updated Google auth device token:', { deviceToken, role: user.roles[0] });
        } catch (oneSignalError) {
          console.error('OneSignal update error:', oneSignalError);
        }
      }

      const payload = {
        user: {
          id: user._id,
          roles: user.roles,
        },
      };
      const token = generateToken(payload, res);
      return res.json({ 
        exists: true, 
        user: {
          ...user.toObject(),
          deviceToken: user.deviceToken
        }, 
        token 
      });
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
    res.status(statusCodes.INTERNAL_SERVER_ERROR).json({ 
      success: false,
      msg: 'Server error during Google authentication',
      error: error.message 
    });
  }
});

// Register
exports.register = asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(statusCodes.BAD_REQUEST).json({ errors: errors.array() });
  }

  const { firstName, lastName, middleName, number, email, password, address } = req.body;
  
  // Check if files were uploaded
  if (!req.files || !req.files.avatar) {
    return res.status(statusCodes.BAD_REQUEST).json({ msg: errorMessages.AVATAR_REQUIRED });
  }
  
  const avatarFile = req.files.avatar[0];
  const cardFile = req.files.card?.[0]; // Optional card file

  // Check if user already exists with email
  let existingUser = await User.findOne({ email });
  if (existingUser) {
    return res.status(statusCodes.CONFLICT).json({ msg: errorMessages.USER_ALREADY_EXISTS });
  }
  
  // Check if phone number is already in use
  existingUser = await User.findOne({ number });
  if (existingUser) {
    return res.status(statusCodes.CONFLICT).json({ 
      msg: "Phone number already in use"
    });
  }

  // Upload avatar to 'avatars' folder in Cloudinary
  const avatarUpload = await uploadToCloudinary(avatarFile.path, 'avatars');
  const avatar = {
    url: avatarUpload.url,
    public_id: avatarUpload.public_id,
  };
  
  // Upload card to 'id_cards' folder in Cloudinary if provided
  let card = null;
  if (cardFile) {
    const cardUpload = await uploadToCloudinary(cardFile.path, 'id_cards');
    card = {
      url: cardUpload.url,
      public_id: cardUpload.public_id,
    };
  }

  // Create new user with both avatar and card (if provided)
  const user = new User({
    firstName,
    lastName,
    middleName,
    number,
    email,
    password,
    address,
    avatar,
    card,
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
exports.logint = asyncHandler(async (req, res) => {
  try {
    const { email, password, deviceToken } = req.body;
    console.log('Login attempt with:', { email, deviceToken });

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(statusCodes.BAD_REQUEST).json({ 
        msg: errorMessages.USER_NOT_FOUND 
      });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(statusCodes.BAD_REQUEST).json({ 
        msg: errorMessages.INVALID_CREDENTIALS 
      });
    }

    if (!user.isVerified) {
      return res.status(statusCodes.UNAUTHORIZED).json({
        msg: errorMessages.EMAIL_NOT_VERIFIED,
        email: user.email
      });
    }

    // Update OneSignal player tags and save device token
    if (deviceToken) {
      try {
        await axios.put(
          `https://onesignal.com/api/v1/players/${deviceToken}`,
          {
            app_id: process.env.ONESIGNAL_APP_ID,
            tags: {
              role: user.roles[0],
              userId: user._id.toString()
            }
          },
          {
            headers: {
              'Authorization': `Basic ${process.env.ONESIGNAL_API_KEY}`,
              'Content-Type': 'application/json'
            }
          }
        );

        user.deviceToken = deviceToken;
        await user.save();
        console.log('Updated player tags and device token:', { deviceToken, role: user.roles[0] });
      } catch (oneSignalError) {
        console.error('OneSignal update error:', oneSignalError);
      }
    }

    const payload = {
      user: {
        id: user.id,
        roles: user.roles,
      }
    };

    generateToken(payload, res);

    res.json({ 
      msg: 'Logged in successfully',
      user: {
        ...user.toObject(),
        deviceToken: user.deviceToken
      }
    });

  } catch (error) {
    console.error('Login error:', error);
    res.status(statusCodes.INTERNAL_SERVER_ERROR).json({
      success: false, 
      msg: 'Login failed',
      error: error.message
    });
  }
});

//filtered login method web and mobile test
// Login with device token
exports.login = asyncHandler(async (req, res) => {
  try {
    const { email, password, deviceToken, platform } = req.body; // Add platform to request body
    console.log('Login attempt with:', { email, deviceToken, platform });

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(statusCodes.BAD_REQUEST).json({ 
        msg: errorMessages.USER_NOT_FOUND 
      });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(statusCodes.BAD_REQUEST).json({ 
        msg: errorMessages.INVALID_CREDENTIALS 
      });
    }

    if (!user.isVerified) {
      return res.status(statusCodes.UNAUTHORIZED).json({
        msg: errorMessages.EMAIL_NOT_VERIFIED,
        email: user.email
      });
    }

    // Update OneSignal player tags and save device token only for mobile platform
    if ((platform !== 'web' || platform == null) && deviceToken) {
      try {
        await axios.put(
          `https://onesignal.com/api/v1/players/${deviceToken}`,
          {
            app_id: process.env.ONESIGNAL_APP_ID,
            tags: {
              role: user.roles[0],
              userId: user._id.toString()
            }
          },
          {
            headers: {
              'Authorization': `Basic ${process.env.ONESIGNAL_API_KEY}`,
              'Content-Type': 'application/json'
            }
          }
        );

        user.deviceToken = deviceToken;
        await user.save();
        console.log('Updated player tags and device token:', { deviceToken, role: user.roles[0] });
      } catch (oneSignalError) {
        console.error('OneSignal update error:', oneSignalError);
      }
    }

    const payload = {
      user: {
        id: user.id,
        roles: user.roles,
      }
    };

    const token = generateToken(payload, res);

    console.log('Logged in successfully:', { email, platform, user: user.deviceToken, token: token });

    res.json({ 
      msg: 'Logged in successfully',
      token,
      user: {

        ...user.toObject(),
        deviceToken: user.deviceToken
      }
    });

  } catch (error) {
    console.error('Login error:', error);
    res.status(statusCodes.INTERNAL_SERVER_ERROR).json({
      success: false, 
      msg: 'Login failed',
      error: error.message
    });
  }
});


// Logout and clear device token
exports.logout = asyncHandler(async (req, res) => {
  try {
    // Only clear device token if user is authenticated
    // if (req.user && req.user.id) {
    //   await User.findByIdAndUpdate(req.user.id, {
    //     deviceToken: null
    //   });
    // }

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
  try {
    const { playerId } = req.body;
    const userId = req.user.id;

    await User.findByIdAndUpdate(userId, {
      deviceToken: playerId
    });

    res.status(statusCodes.OK).json({
      success: true,
      msg: 'Device token updated'
    });
  } catch (error) {
    console.error('Token update error:', error);
    res.status(statusCodes.INTERNAL_SERVER_ERROR).json({
      success: false,
      msg: 'Failed to update device token'
    });
  }
});


// exports.logout = asyncHandler(async (req, res) => {
//   try {
//     // 1. Check if user has device token
//     if (req.user && req.user.id) {
//       const user = await User.findById(req.user.id);
      
//       if (user?.deviceToken) {
//         // 2. Remove OneSignal tags
//         await axios.put(
//           `https://onesignal.com/api/v1/players/${user.deviceToken}`,
//           {
//             app_id: process.env.ONESIGNAL_APP_ID,
//             tags: {
//               role: '',
//               userId: ''
//             }
//           },
//           {
//             headers: {
//               'Authorization': `Basic ${process.env.ONESIGNAL_REST_API_KEY}`,
//               'Content-Type': 'application/json'
//             }
//           }
//         );

//         // 3. Clear device token from user
//         user.deviceToken = null;
//         await user.save();
//       }
//     }

//     // 4. Clear auth cookie
//     res.clearCookie('token', {
//       httpOnly: true,
//       secure: process.env.NODE_ENV === 'production',
//       sameSite: 'Lax',
//       path: '/'
//     });

//     res.status(statusCodes.OK).json({ 
//       success: true,
//       msg: 'Logged out successfully',
//       tokenCleared: true 
//     });

//   } catch (error) {
//     console.error('Logout error:', error);
//     res.status(statusCodes.INTERNAL_SERVER_ERROR).json({
//       success: false,
//       msg: 'Error during logout',
//       error: error.message
//     });
//   }
// });