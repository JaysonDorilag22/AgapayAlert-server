// controllers/messengerAuthController.js

const User = require('../models/userModel');
const asyncHandler = require('express-async-handler');
const statusCodes = require('../constants/statusCodes');


exports.linkMessengerAccount = asyncHandler(async (req, res) => {

  console.log*('📱 Linking messenger account...');
  try {
    const { psid } = req.body;
    const userId = req.user.id;

    console.log('📱 Linking messenger account...');
    console.log('Request body:', req.body);
    console.log('User ID:', userId);
    console.log('PSID:', psid);

    if (!psid) {
      console.log('❌ PSID missing in request');
      return res.status(statusCodes.BAD_REQUEST).json({
        success: false,
        msg: 'Messenger PSID is required'
      });
    }

    // Update user with PSID
    const user = await User.findByIdAndUpdate(
      userId,
      { messengerPSID: psid },
      { new: true }
    ).select('-password');

    console.log('Updated user:', user);

    if (!user) {
      console.log('❌ User not found:', userId);
      return res.status(statusCodes.NOT_FOUND).json({
        success: false,
        msg: 'User not found'
      });
    }

    console.log('✅ Messenger account linked successfully');
    res.status(statusCodes.OK).json({
      success: true,
      msg: 'Messenger account linked successfully',
      data: user
    });

  } catch (error) {
    console.error('❌ Error linking messenger account:', error);
    res.status(statusCodes.INTERNAL_SERVER_ERROR).json({
      success: false,
      msg: 'Error linking messenger account',
      error: error.message
    });
  }
});

exports.unlinkMessengerAccount = asyncHandler(async (req, res) => {
  try {
    const userId = req.user.id;

    const user = await User.findByIdAndUpdate(
      userId,
      { $unset: { messengerPSID: 1 } },
      { new: true }
    ).select('-password');

    if (!user) {
      return res.status(statusCodes.NOT_FOUND).json({
        success: false,
        msg: 'User not found'
      });
    }

    res.status(statusCodes.OK).json({
      success: true,
      msg: 'Messenger account unlinked successfully',
      data: user
    });

  } catch (error) {
    console.error('Error unlinking messenger account:', error);
    res.status(statusCodes.INTERNAL_SERVER_ERROR).json({
      success: false,
      msg: 'Error unlinking messenger account',
      error: error.message
    });
  }
});

exports.getMessengerStatus = asyncHandler(async (req, res) => {
  try {
    console.log('🔍 Checking messenger status for user:', req.user.id);
    
    const user = await User.findById(req.user.id)
      .select('messengerPSID')
      .lean();

    const isLinked = !!user?.messengerPSID;
    console.log('✅ Messenger status:', { isLinked, psid: user?.messengerPSID });

    res.status(statusCodes.OK).json({
      success: true,
      isLinked: isLinked,
      psid: user?.messengerPSID
    });

  } catch (error) {
    console.error('❌ Error getting messenger status:', error);
    res.status(statusCodes.INTERNAL_SERVER_ERROR).json({
      success: false,
      msg: 'Error getting messenger status',
      error: error.message
    });
  }
});