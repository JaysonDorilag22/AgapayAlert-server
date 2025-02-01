const User = require('../models/userModel');
const PoliceStation = require('../models/policeStationModel');
const asyncHandler = require('express-async-handler');
const statusCodes = require('../constants/statusCodes');
const errorMessages = require('../constants/errorMessages');
const uploadToCloudinary = require('../utils/uploadToCloudinary');
const cloudinary = require('cloudinary').v2;
const bcrypt = require('bcryptjs');
const { getIO, SOCKET_EVENTS } = require('../utils/socketUtils');

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
    return res.status(statusCodes.BAD_REQUEST).json({ msg: 'Current password did not match' });
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
  try {
    const { firstName, lastName, number, email, password, address, role, policeStationId } = req.body;
    const creatorRole = req.user.roles[0];
    const file = req.file;

    // Validate allowed role creation based on creator's role
    const allowedRoles = {
      police_admin: ['police_officer'],
      city_admin: ['police_admin', 'police_officer'],
      super_admin: ['city_admin', 'police_admin', 'police_officer']
    };

    if (!allowedRoles[creatorRole]?.includes(role)) {
      return res.status(statusCodes.FORBIDDEN).json({ 
        success: false,
        msg: `${creatorRole} cannot create ${role} accounts` 
      });
    }

    // Check if user already exists
    let user = await User.findOne({ email });
    if (user) {
      return res.status(statusCodes.CONFLICT).json({ 
        msg: errorMessages.USER_ALREADY_EXISTS 
      });
    }

    // Handle avatar
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

    // Validate police station and city based on creator's role
    let policeStation = null;
    if (role === 'police_officer' || role === 'police_admin') {
      policeStation = await PoliceStation.findById(policeStationId);
      
      if (!policeStation) {
        return res.status(statusCodes.BAD_REQUEST).json({ 
          msg: errorMessages.POLICE_STATION_NOT_FOUND 
        });
      }

      // For police_admin creating officers
      if (creatorRole === 'police_admin') {
        if (policeStation._id.toString() !== req.user.policeStation.toString()) {
          return res.status(statusCodes.FORBIDDEN).json({
            success: false,
            msg: 'Can only create officers for your own police station'
          });
        }
      }

      // For city_admin creating police_admin/officers
      if (creatorRole === 'city_admin') {
        if (policeStation.address.city !== req.user.address.city) {
          return res.status(statusCodes.FORBIDDEN).json({
            success: false,
            msg: 'Can only create users for police stations in your city'
          });
        }
      }
    }

    // For city_admin role, ensure city matches creator's city
    if (role === 'city_admin' && creatorRole === 'super_admin') {
      if (!address?.city) {
        return res.status(statusCodes.BAD_REQUEST).json({
          success: false,
          msg: 'City is required for city admin accounts'
        });
      }
    }

    // Create user
    user = new User({
      firstName,
      lastName,
      number,
      email,
      password,
      address,
      roles: [role],
      policeStation: policeStation ? policeStation._id : null,
      isVerified: true,
      avatar,
    });

    await user.save();

    res.status(statusCodes.CREATED).json({
      success: true,
      msg: 'User created successfully',
      data: {
        user: {
          ...user.toObject(),
          password: undefined
        }
      }
    });

  } catch (error) {
    console.error('Error creating user:', error);
    res.status(statusCodes.INTERNAL_SERVER_ERROR).json({ 
      success: false,
      msg: 'Error creating user', 
      error: error.message 
    });
  }
});

// Get users based on role and permissions
exports.getUsers = asyncHandler(async (req, res) => {
  try {
    const { 
      role, 
      city, 
      policeStation,
      search,
      isActive,
      page = 1, 
      limit = 10 
    } = req.query;
    
    const userRole = req.user.roles[0];
    let query = {};

    // Base query for search
    if (search) {
      query.$or = [
        { firstName: { $regex: search, $options: 'i' } },
        { lastName: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } }
      ];
    }

    // Filter by active status
    if (isActive !== undefined) {
      query.isActive = isActive === 'true';
    }

    // Role-based query building
    switch (userRole) {
      case 'police_officer':
      case 'police_admin':
        if (!req.user.policeStation) {
          return res.status(statusCodes.BAD_REQUEST).json({
            success: false,
            msg: 'No police station assigned'
          });
        }
        query.policeStation = req.user.policeStation;
        if (role) query.roles = role;
        break;

      case 'city_admin':
        const cityStations = await PoliceStation.find({
          'address.city': req.user.address.city
        });
        
        let cityQuery = {
          $or: [
            { 
              policeStation: { 
                $in: cityStations.map(station => station._id) 
              }
            },
            {
              roles: 'city_admin',
              'address.city': req.user.address.city
            }
          ]
        };

        // Add filters
        if (role) cityQuery.roles = role;
        if (policeStation && cityStations.find(s => s._id.toString() === policeStation)) {
          cityQuery.policeStation = policeStation;
        }

        query = { ...query, ...cityQuery };
        break;

      case 'super_admin':
        if (role) query.roles = role;
        if (city) query['address.city'] = city;
        if (policeStation) query.policeStation = policeStation;
        break;

      default:
        return res.status(statusCodes.FORBIDDEN).json({
          success: false,
          msg: 'Not authorized to view users'
        });
    }

    // Execute query with pagination
    const users = await User.find(query)
      .select('-password')
      .populate('policeStation', 'name address')
      .sort('firstName')
      .skip((page - 1) * limit)
      .limit(parseInt(limit));

    const total = await User.countDocuments(query);

    res.status(statusCodes.OK).json({
      success: true,
      data: {
        users,
        filters: {
          role,
          city,
          policeStation,
          search,
          isActive
        },
        currentPage: parseInt(page),
        totalPages: Math.ceil(total / limit),
        totalUsers: total,
        hasMore: page * limit < total
      }
    });

  } catch (error) {
    console.error('Error fetching users:', error);
    res.status(statusCodes.INTERNAL_SERVER_ERROR).json({
      success: false,
      msg: 'Error retrieving users',
      error: error.message
    });
  }
});

// Update Duty Status
exports.updateDutyStatus = asyncHandler(async (req, res) => {
  try {
    const userId = req.user.id;
    const { isOnDuty } = req.body;

    // Validate police role
    if (!req.user.roles.includes('police_officer')) {
      return res.status(statusCodes.FORBIDDEN).json({
        success: false,
        msg: 'Only police officers can update duty status'
      });
    }

    const user = await User.findById(userId)
      .populate('policeStation', 'name');
    
    if (!user) {
      return res.status(statusCodes.NOT_FOUND).json({
        success: false,
        msg: 'User not found'
      });
    }

    const now = new Date();
    const MIN_DUTY_HOURS = 8;

    // Check minimum hours
    if (!isOnDuty && user.isOnDuty && user.lastDutyChange) {
      const hoursWorked = (now - user.lastDutyChange) / (1000 * 60 * 60);
      
      if (hoursWorked < MIN_DUTY_HOURS) {
        return res.status(statusCodes.BAD_REQUEST).json({
          success: false,
          msg: `Cannot go off duty before completing minimum ${MIN_DUTY_HOURS} hours. Hours worked: ${hoursWorked.toFixed(2)}`
        });
      }
    }

    // Update duty history when going off duty
    if (!isOnDuty && user.isOnDuty) {
      user.dutyHistory.push({
        startTime: user.lastDutyChange,
        endTime: now,
        duration: (now - user.lastDutyChange) / (1000 * 60 * 60)
      });
    }

    // Update status
    user.isOnDuty = isOnDuty;
    user.lastDutyChange = isOnDuty ? now : null;
    
    await user.save();

    // Get Socket.IO instance
    const io = getIO();

    // Emit to police station room for real-time updates
    io.to(`policeStation_${user.policeStation._id}`).emit('DUTY_STATUS_CHANGED', {
      officerId: user._id,
      name: `${user.firstName} ${user.lastName}`,
      isOnDuty: user.isOnDuty,
      lastDutyChange: user.lastDutyChange,
      station: user.policeStation.name,
      dutyHistory: user.dutyHistory,
      message: `Officer ${user.firstName} ${user.lastName} is now ${isOnDuty ? 'on duty' : 'off duty'}`
    });

    // Emit to admin room
    io.to('role_police_admin').emit('DUTY_STATUS_CHANGED', {
      officerId: user._id,
      name: `${user.firstName} ${user.lastName}`,
      isOnDuty: user.isOnDuty,
      lastDutyChange: user.lastDutyChange,
      station: user.policeStation.name,
      dutyHistory: user.dutyHistory,
      message: `Officer ${user.firstName} ${user.lastName} is now ${isOnDuty ? 'on duty' : 'off duty'}`
    });

    res.status(statusCodes.OK).json({
      success: true,
      msg: `Duty status updated to ${isOnDuty ? 'on duty' : 'off duty'}`,
      data: {
        isOnDuty: user.isOnDuty,
        lastDutyChange: user.lastDutyChange,
        dutyHistory: user.dutyHistory
      }
    });

  } catch (error) {
    console.error('Error updating duty status:', error);
    res.status(statusCodes.INTERNAL_SERVER_ERROR).json({
      success: false,
      msg: 'Error updating duty status',
      error: error.message
    });
  }
});

