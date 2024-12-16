const express = require('express');
const router = express.Router();
const multer = require('multer');
const authController = require('../controllers/authController');

const upload = multer({ dest: 'uploads/' });

// Register route with file upload
router.post('/register', upload.single('avatar'), authController.register);

// Verify account route
router.post('/verify-account', authController.verifyAccount);

// Login route
router.post('/login', authController.login);

module.exports = router;