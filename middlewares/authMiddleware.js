const jwt = require('jsonwebtoken');
const User = require('../models/userModel');
const asyncHandler = require('express-async-handler');
const statusCodes = require('../constants/statusCodes');
const errorMessages = require('../constants/errorMessages');

exports.protect = asyncHandler(async (req, res, next) => {
  let token;

  if (req.cookies && req.cookies.token) {
    token = req.cookies.token;
  } else if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    token = req.headers.authorization.split(' ')[1];
  }

  if (!token) {
    return res.status(statusCodes.UNAUTHORIZED).json({ msg: errorMessages.UNAUTHORIZED });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = await User.findById(decoded.user.id).select('-password');
    if (!req.user) {
      return res.status(statusCodes.UNAUTHORIZED).json({ msg: errorMessages.UNAUTHORIZED });
    }
    next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(statusCodes.UNAUTHORIZED).json({ msg: 'Token expired, please log in again' });
    }
    return res.status(statusCodes.UNAUTHORIZED).json({ msg: errorMessages.UNAUTHORIZED });
  }
});