const User = require("../models/userModel");
const PoliceStation = require("../models/policeStationModel");
const Report = require("../models/reportModel");
const asyncHandler = require("express-async-handler");
const statusCodes = require("../constants/statusCodes");
const errorMessages = require("../constants/errorMessages");
const uploadToCloudinary = require("../utils/uploadToCloudinary");
const cloudinary = require("cloudinary").v2;
const bcrypt = require("bcryptjs");
const { getIO, SOCKET_EVENTS } = require("../utils/socketUtils");
const { getCoordinatesFromAddress } = require("../utils/geocoding");

// Get user details
exports.getUserDetails = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.userId).select("-password");

  if (!user) {
    return res.status(statusCodes.NOT_FOUND).json({ msg: errorMessages.USER_NOT_FOUND });
  }

  res.status(statusCodes.OK).json(user);
});

// Fetch all users
exports.getAllUsers = asyncHandler(async (req, res) => {
  const users = await User.find().select('-password');
  res.status(statusCodes.OK).json(users);
});

// Update user details
exports.updateUserDetails = asyncHandler(async (req, res) => {
  const { firstName, lastName, middleName, number, address, preferredNotifications } = req.body;
  const files = req.files || {}; // Handle multiple file uploads

  const user = await User.findById(req.params.userId);

  if (!user) {
    return res.status(statusCodes.NOT_FOUND).json({ msg: errorMessages.USER_NOT_FOUND });
  }

  // Handle avatar update
  if (files.avatar && files.avatar[0]) {
    // Delete old avatar from Cloudinary
    if (user.avatar.public_id && user.avatar.public_id !== 'default_avatar') {
      await cloudinary.uploader.destroy(user.avatar.public_id);
    }

    // Upload new avatar to Cloudinary
    const avatarUpload = await uploadToCloudinary(files.avatar[0].path, "avatars");
    user.avatar = {
      url: avatarUpload.url,
      public_id: avatarUpload.public_id,
    };
  }

  // Handle ID card update
  if (files.card && files.card[0]) {
    // Delete old card from Cloudinary
    if (user.card.public_id && user.card.public_id !== 'default_avatar') {
      await cloudinary.uploader.destroy(user.card.public_id);
    }

    // Upload new card to Cloudinary
    const cardUpload = await uploadToCloudinary(files.card[0].path, "id_cards");
    user.card = {
      url: cardUpload.url,
      public_id: cardUpload.public_id,
    };
  }

  // Update user fields
  user.firstName = firstName || user.firstName;
  user.lastName = lastName || user.lastName;
  user.middleName = middleName || user.middleName;
  user.number = number || user.number;
  user.address = address || user.address;

  if (preferredNotifications) {
    const { sms, push, email } = preferredNotifications;
    const notificationCount = [sms, push, email].filter(Boolean).length;

    if (notificationCount > 1) {
      return res.status(statusCodes.BAD_REQUEST).json({ msg: "Only one notification type can be set to true" });
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
    return res.status(statusCodes.BAD_REQUEST).json({ msg: "Current password did not match" });
  }

  user.password = newPassword;
  await user.save();

  res.status(statusCodes.OK).json({ msg: "Password changed successfully" });
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

  res.status(statusCodes.OK).json({ msg: "User deleted successfully" });
});

// Create a new user with a specific role
exports.createUserWithRole = asyncHandler(async (req, res) => {
  try {
    const { firstName, lastName, number, email, password, address, role, policeStationId } = req.body;
    const creatorRole = req.user.roles[0];
    const file = req.file;

    // Check if user already exists
    let user = await User.findOne({ email });
    if (user) {
      return res.status(statusCodes.CONFLICT).json({
        msg: errorMessages.USER_ALREADY_EXISTS,
      });
    }

    // Get coordinates from address
    const geoData = await getCoordinatesFromAddress(address);
    if (!geoData.success) {
      return res.status(statusCodes.BAD_REQUEST).json({
        success: false,
        msg: geoData.message
      });
    }

    // Handle avatar
    let avatar = {
      url: "https://cdn.pixabay.com/photo/2015/10/05/22/37/blank-profile-picture-973460_1280.png",
      public_id: "default_avatar",
    };

    if (file) {
      const uploadResult = await uploadToCloudinary(file.path, "avatars");
      avatar = {
        url: uploadResult.url,
        public_id: uploadResult.public_id,
      };
    }

    // Validate police station and city based on creator's role
    let policeStation = null;
    if (role === "police_officer" || role === "police_admin") {
      policeStation = await PoliceStation.findById(policeStationId);

      if (!policeStation) {
        return res.status(statusCodes.BAD_REQUEST).json({
          msg: errorMessages.POLICE_STATION_NOT_FOUND,
        });
      }

      // For police_admin creating officers
      if (creatorRole === "police_admin") {
        if (policeStation._id.toString() !== req.user.policeStation.toString()) {
          return res.status(statusCodes.FORBIDDEN).json({
            success: false,
            msg: "Can only create officers for your own police station",
          });
        }
      }

      // For city_admin creating police_admin/officers
      if (creatorRole === "city_admin") {
        if (policeStation.address.city !== req.user.address.city) {
          return res.status(statusCodes.FORBIDDEN).json({
            success: false,
            msg: "Can only create users for police stations in your city",
          });
        }
      }
    }

    // For city_admin role, ensure city matches creator's city
    if (role === "city_admin" && creatorRole === "super_admin") {
      if (!address?.city) {
        return res.status(statusCodes.BAD_REQUEST).json({
          success: false,
          msg: "City is required for city admin accounts",
        });
      }
    }

    // Create user with address location
    user = new User({
      firstName,
      lastName,
      number,
      email,
      password,
      address: {
        ...address,
        location: {
          type: "Point",
          coordinates: geoData.coordinates
        }
      },
      roles: [role],
      policeStation: policeStation ? policeStation._id : null,
      isVerified: true,
      avatar,
    });

    await user.save();

    res.status(statusCodes.CREATED).json({
      success: true,
      msg: "User created successfully",
      data: {
        user: {
          ...user.toObject(),
          password: undefined,
        },
      },
    });
  } catch (error) {
    console.error("Error creating user:", error);
    res.status(statusCodes.INTERNAL_SERVER_ERROR).json({
      success: false,
      msg: "Error creating user",
      error: error.message,
    });
  }
});

// Get users based on role and permissions
exports.getUsers = asyncHandler(async (req, res) => {
  try {
    const { role, city, policeStation, search, isActive, page = 1, limit = 10 } = req.query;

    const userRole = req.user.roles[0];
    let query = {
      // Only get police officers and admins
      roles: { $in: ["police_officer", "police_admin"] }
    };

    // Base query for search
    if (search) {
      query.$or = [
        { firstName: { $regex: search, $options: "i" } },
        { lastName: { $regex: search, $options: "i" } },
        { email: { $regex: search, $options: "i" } },
      ];
    }

    // Filter by active status
    if (isActive !== undefined) {
      query.isActive = isActive === "true";
    }

    // Role-based query building
    switch (userRole) {
      case "police_officer":
      case "police_admin":
        if (!req.user.policeStation) {
          return res.status(statusCodes.BAD_REQUEST).json({
            success: false,
            msg: "No police station assigned",
          });
        }
        query.policeStation = req.user.policeStation;
        if (role) query.roles = role;
        break;

      case "city_admin":
        const cityStations = await PoliceStation.find({
          "address.city": req.user.address.city,
        });

        query.policeStation = {
          $in: cityStations.map((station) => station._id)
        };

        if (policeStation) {
          query.policeStation = policeStation;
        }
        break;

      case "super_admin":
        if (city) query["address.city"] = city;
        if (policeStation) query.policeStation = policeStation;
        break;

      default:
        return res.status(statusCodes.FORBIDDEN).json({
          success: false,
          msg: "Not authorized to view users",
        });
    }

    // Execute query with pagination
    const users = await User.find(query)
      .select("-password")
      .populate("policeStation", "name address")
      .sort("firstName")
      .skip((page - 1) * limit)
      .limit(parseInt(limit));

    const total = await User.countDocuments(query);

    console.log('Query:', query);
    console.log('Total users found:', total);

    res.status(statusCodes.OK).json({
      success: true,
      data: {
        users,
        filters: {
          role,
          city,
          policeStation,
          search,
          isActive,
        },
        currentPage: parseInt(page),
        totalPages: Math.ceil(total / limit),
        totalUsers: total,
        hasMore: page * limit < total,
      },
    });
  } catch (error) {
    console.error("Error fetching users:", error);
    res.status(statusCodes.INTERNAL_SERVER_ERROR).json({
      success: false,
      msg: "Error retrieving users",
      error: error.message,
    });
  }
});

// Update Duty Status
exports.updateDutyStatus = asyncHandler(async (req, res) => {
  console.log("touch");
  try {
    const userId = req.user.id;
    const { isOnDuty } = req.body;

    // Validate police roles
    if (!req.user.roles.some((role) => ["police_officer", "police_admin"].includes(role))) {
      return res.status(statusCodes.FORBIDDEN).json({
        success: false,
        msg: "Only police officers and admins can update duty status",
      });
    }

    const user = await User.findById(userId).populate("policeStation", "name");

    if (!user) {
      return res.status(statusCodes.NOT_FOUND).json({
        success: false,
        msg: "User not found",
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
          msg: `Cannot go off duty before completing minimum ${MIN_DUTY_HOURS} hours. Hours worked: ${hoursWorked.toFixed(
            2
          )}`,
        });
      }
    }

    // Update duty history when going off duty
    if (!isOnDuty && user.isOnDuty) {
      user.dutyHistory.push({
        startTime: user.lastDutyChange,
        endTime: now,
        duration: (now - user.lastDutyChange) / (1000 * 60 * 60),
      });
    }

    // Update status
    user.isOnDuty = isOnDuty;
    user.lastDutyChange = isOnDuty ? now : null;

    await user.save();

    // Get Socket.IO instance
    const io = getIO();

    // Emit to police station room for real-time updates
    io.to(`policeStation_${user.policeStation._id}`).emit("DUTY_STATUS_CHANGED", {
      officerId: user._id,
      name: `${user.firstName} ${user.lastName}`,
      role: user.roles[0], // Add role to identify if admin or officer
      isOnDuty: user.isOnDuty,
      lastDutyChange: user.lastDutyChange,
      station: user.policeStation.name,
      dutyHistory: user.dutyHistory,
      message: `${user.roles[0] === "police_admin" ? "Admin" : "Officer"} ${user.firstName} ${user.lastName} is now ${
        isOnDuty ? "on duty" : "off duty"
      }`,
    });

    // Emit to admin room
    io.to("role_police_admin").emit("DUTY_STATUS_CHANGED", {
      officerId: user._id,
      name: `${user.firstName} ${user.lastName}`,
      role: user.roles[0],
      isOnDuty: user.isOnDuty,
      lastDutyChange: user.lastDutyChange,
      station: user.policeStation.name,
      dutyHistory: user.dutyHistory,
      message: `${user.roles[0] === "police_admin" ? "Admin" : "Officer"} ${user.firstName} ${user.lastName} is now ${
        isOnDuty ? "on duty" : "off duty"
      }`,
    });

    res.status(statusCodes.OK).json({
      success: true,
      msg: `Duty status updated to ${isOnDuty ? "on duty" : "off duty"}`,
      data: {
        isOnDuty: user.isOnDuty,
        lastDutyChange: user.lastDutyChange,
        dutyHistory: user.dutyHistory,
      },
    });
  } catch (error) {
    console.error("Error updating duty status:", error);
    res.status(statusCodes.INTERNAL_SERVER_ERROR).json({
      success: false,
      msg: "Error updating duty status",
      error: error.message,
    });
  }
});

// Get police station officers and their reports
exports.getPoliceStationOfficers = asyncHandler(async (req, res) => {
  try {
    const { policeStationId } = req.params;

    // Validate policeStationId
    if (!policeStationId || policeStationId === "null") {
      return res.status(statusCodes.BAD_REQUEST).json({
        success: false,
        msg: "Valid police station ID is required",
      });
    }

    const io = getIO();
    const room = `policeStation_${policeStationId}`;

    // Validate police station exists
    const policeStation = await PoliceStation.findById(policeStationId);
    if (!policeStation) {
      return res.status(statusCodes.NOT_FOUND).json({
        success: false,
        msg: "Police station not found",
      });
    }

    // Get all officers in the police station
    const officers = await User.find({
      policeStation: policeStationId,
      roles: "police_officer",
    })
      .select("firstName lastName isOnDuty lastDutyChange dutyHistory avatar")
      .lean();

    // Get all reports assigned to officers in this station
    const reports = await Report.find({
      assignedPoliceStation: policeStationId,
      assignedOfficer: { $exists: true },
    })
      .select("type status assignedOfficer personInvolved location createdAt")
      .populate("assignedOfficer", "firstName lastName")
      .lean();

    // Map reports to officers
    const officersWithReports = officers.map((officer) => {
      const officerReports = reports.filter(
        (report) => report.assignedOfficer && report.assignedOfficer._id.toString() === officer._id.toString()
      );

      return {
        ...officer,
        reports: officerReports,
        activeReports: officerReports.filter((r) => r.status !== "Resolved").length,
        totalReports: officerReports.length,
      };
    });

    // Set up Socket.IO event handlers at the server level
    io.on("connection", (socket) => {
      // Join the police station room
      socket.join(room);

      // Handle officer status updates
      socket.on("OFFICER_STATUS_UPDATE", async (data) => {
        if (!data.officerId) return;

        const updatedOfficer = await User.findById(data.officerId)
          .select("firstName lastName isOnDuty lastDutyChange dutyHistory")
          .lean();

        if (updatedOfficer) {
          io.to(room).emit("OFFICER_UPDATED", {
            officerId: updatedOfficer._id,
            isOnDuty: updatedOfficer.isOnDuty,
            lastDutyChange: updatedOfficer.lastDutyChange,
            dutyHistory: updatedOfficer.dutyHistory,
          });
        }
      });

      // Handle report assignments
      socket.on("REPORT_ASSIGNED", async (data) => {
        if (!data.reportId) return;

        const updatedReport = await Report.findById(data.reportId)
          .select("type status assignedOfficer personInvolved location createdAt")
          .populate("assignedOfficer", "firstName lastName")
          .lean();

        if (updatedReport) {
          io.to(room).emit("REPORT_UPDATED", {
            report: updatedReport,
          });
        }
      });
    });

    const summary = {
      totalOfficers: officers.length,
      onDutyOfficers: officers.filter((o) => o.isOnDuty).length,
      totalReports: reports.length,
      activeReports: reports.filter((r) => r.status !== "Resolved").length,
    };

    // Map and log officer details
    officers.forEach((officer) => {
      const officerReports = reports.filter(
        (report) => report.assignedOfficer && report.assignedOfficer._id.toString() === officer._id.toString()
      );

      console.log(`\n👮 ${officer.firstName} ${officer.lastName}:`, {
        isOnDuty: officer.isOnDuty ? "✅ On Duty" : "❌ Off Duty",
        lastDutyChange: officer.lastDutyChange ? new Date(officer.lastDutyChange).toLocaleString() : "N/A",
        totalReports: officerReports.length,
        activeReports: officerReports.filter((r) => r.status !== "Resolved").length,
        resolvedReports: officerReports.filter((r) => r.status === "Resolved").length,
      });
    });

    res.status(statusCodes.OK).json({
      success: true,
      data: {
        policeStation: {
          name: policeStation.name,
          address: policeStation.address,
        },
        officers: officersWithReports,
        summary,
      },
    });
  } catch (error) {
    console.error("Error getting police station officers:", error);
    res.status(statusCodes.INTERNAL_SERVER_ERROR).json({
      success: false,
      msg: "Error retrieving police station officers",
      error: error.message,
    });
  }
});

exports.updateLiveLocation = asyncHandler(async (req, res) => {
  try {
    const userId = req.user.id;
    const { latitude, longitude } = req.body;

    // Validate coordinates
    if (!latitude || !longitude) {
      return res.status(statusCodes.BAD_REQUEST).json({
        success: false,
        msg: 'Latitude and longitude are required'
      });
    }

    // Validate coordinate ranges
    if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
      return res.status(statusCodes.BAD_REQUEST).json({
        success: false,
        msg: 'Invalid coordinates'
      });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(statusCodes.NOT_FOUND).json({
        success: false,
        msg: 'User not found'
      });
    }

    // Update user's live location
    user.liveLocation = {
      type: 'Point',
      coordinates: [longitude, latitude],
      lastUpdated: new Date()
    };

    await user.save();

    // Get Socket.IO instance
    const io = getIO();

    // Emit location update based on user role
    switch (user.roles[0]) {
      case 'police_officer':
      case 'police_admin':
        if (user.policeStation) {
          io.to(`policeStation_${user.policeStation}`).emit('LOCATION_UPDATED', {
            userId: user._id,
            name: `${user.firstName} ${user.lastName}`,
            role: user.roles[0],
            location: user.liveLocation,
            isOnDuty: user.isOnDuty
          });
        }
        break;
      
      case 'city_admin':
        io.to(`city_${user.address.city}`).emit('LOCATION_UPDATED', {
          userId: user._id,
          name: `${user.firstName} ${user.lastName}`,
          role: user.roles[0],
          location: user.liveLocation
        });
        break;
    }

    res.status(statusCodes.OK).json({
      success: true,
      msg: 'Live location updated successfully',
      data: {
        location: user.liveLocation,
        lastUpdated: user.liveLocation.lastUpdated
      }
    });

  } catch (error) {
    console.error('Error updating live location:', error);
    res.status(statusCodes.INTERNAL_SERVER_ERROR).json({
      success: false,
      msg: 'Error updating live location',
      error: error.message
    });
  }
});
