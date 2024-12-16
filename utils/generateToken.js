const jwt = require('jsonwebtoken');
const dotenv = require('dotenv');

dotenv.config();

/**
 * Generate a JWT token.
 * @param {Object} payload - The payload to include in the token.
 * @returns {string} - The generated JWT token.
 */
const generateToken = (payload) => {
  const expiresIn = process.env.JWT_EXPIRES_IN || '7d'; 
  return jwt.sign(payload, process.env.JWT_SECRET, { expiresIn });
};

module.exports = generateToken;