const statusCodes = require('../constants/statusCodes');
const errorMessages = require('../constants/errorMessages');

const authorizeRoles = (...roles) => {
  return (req, res, next) => {
    if (!roles.includes(req.user.roles[0])) {
      return res.status(statusCodes.FORBIDDEN).json({ msg: errorMessages.FORBIDDEN });
    }
    next();
  };
};

module.exports = authorizeRoles;