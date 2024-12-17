const jwt = require('jsonwebtoken');
const dotenv = require('dotenv');

dotenv.config();

/**
 * Generate a JWT token and set it as a cookie.
 * @param {Object} payload - The payload to include in the token.
 * @param {Object} res - The response object to set the cookie.
 */
const generateToken = (payload, res) => {
  const expiresIn = process.env.JWT_EXPIRES_IN || '7d';
  const token = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn });

  // Set token in cookie
  res.cookie('token', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
  });

  return token;
};

module.exports = generateToken;