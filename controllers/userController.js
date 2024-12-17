const User = require('../models/userModel');
const asyncHandler = require('express-async-handler');
const statusCodes = require('../constants/statusCodes');
const errorMessages = require('../constants/errorMessages');
const uploadToCloudinary = require('../utils/uploadToCloudinary');
const cloudinary = require('cloudinary').v2;
const bcrypt = require('bcryptjs');

// Get user details
exports.getUserDetails = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.userId).select('-password');

  if (!user) {
    return res.status(statusCodes.NOT_FOUND).json({ msg: errorMessages.USER_NOT_FOUND });
  }

  res.status(statusCodes.OK).json(user);
});

// Update user details
exports.updateUserDetails = asyncHandler(async (req, res) => {
  const { firstName, lastName, number, address, preferredNotifications } = req.body;
  const file = req.file; // Assuming you're using multer to handle file uploads

  const user = await User.findById(req.params.userId);

  if (!user) {
    return res.status(statusCodes.NOT_FOUND).json({ msg: errorMessages.USER_NOT_FOUND });
  }

  if (file) {
    // Delete old avatar from Cloudinary
    if (user.avatar.public_id) {
      await cloudinary.uploader.destroy(user.avatar.public_id);
    }

    // Upload new avatar to Cloudinary
    const uploadResult = await uploadToCloudinary(file.path, 'avatars');
    user.avatar = {
      url: uploadResult.url,
      public_id: uploadResult.public_id,
    };
  }

  user.firstName = firstName || user.firstName;
  user.lastName = lastName || user.lastName;
  user.number = number || user.number;
  user.address = address || user.address;

  if (preferredNotifications) {
    const { sms, push, email } = preferredNotifications;
    const notificationCount = [sms, push, email].filter(Boolean).length;

    if (notificationCount > 1) {
      return res.status(statusCodes.BAD_REQUEST).json({ msg: 'Only one notification type can be set to true' });
    }

    user.preferredNotifications = preferredNotifications;
  }

  await user.save();

  res.status(statusCodes.OK).json(user);
});

// Change user password
exports.changePassword = asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body;

  const user = await User.findById(req.params.userId);

  if (!user) {
    return res.status(statusCodes.NOT_FOUND).json({ msg: errorMessages.USER_NOT_FOUND });
  }

  const isMatch = await bcrypt.compare(currentPassword, user.password);

  if (!isMatch) {
    return res.status(statusCodes.BAD_REQUEST).json({ msg: errorMessages.INVALID_CREDENTIALS });
  }

  user.password = newPassword;
  await user.save();

  res.status(statusCodes.OK).json({ msg: 'Password changed successfully' });
});

// Delete user
exports.deleteUser = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.userId);

  if (!user) {
    return res.status(statusCodes.NOT_FOUND).json({ msg: errorMessages.USER_NOT_FOUND });
  }

  if (user.avatar.public_id) {
    await cloudinary.uploader.destroy(user.avatar.public_id);
  }

  await user.deleteOne();

  res.status(statusCodes.OK).json({ msg: 'User deleted successfully' });
});


// Create a new user with a specific role
exports.createUserWithRole = asyncHandler(async (req, res) => {
  const { firstName, lastName, number, email, password, address, role } = req.body;
  const file = req.file; // Assuming you're using multer to handle file uploads

  let user = await User.findOne({ email });
  if (user) {
    return res.status(statusCodes.CONFLICT).json({ msg: errorMessages.USER_ALREADY_EXISTS });
  }

  let avatar = {
    url: 'https://cdn.pixabay.com/photo/2015/10/05/22/37/blank-profile-picture-973460_1280.png',
    public_id: 'default_avatar',
  };

  if (file) {
    const uploadResult = await uploadToCloudinary(file.path, 'avatars');
    avatar = {
      url: uploadResult.url,
      public_id: uploadResult.public_id,
    };
  }

  user = new User({
    firstName,
    lastName,
    number,
    email,
    password,
    address,
    roles: [role],
    isVerified: true, // Set the user as verified by default
    avatar,
  });

  await user.save();

  res.status(statusCodes.CREATED).json(user);
});