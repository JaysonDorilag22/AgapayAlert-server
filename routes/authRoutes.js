const express = require('express');
const router = express.Router();
const multer = require('multer');
const passport = require('passport');
const authController = require('../controllers/authController');

const upload = multer({ dest: 'uploads/' });

router.post('/register', upload.single('avatar'), authController.register);
router.post('/verify-account', authController.verifyAccount);
router.post('/login', authController.login);
router.post('/forgot-password', authController.forgotPassword)
router.post('/reset-password', authController.resetPassword)
router.post('/logout', authController.logout)
router.post('/resend-verification', authController.resendVerification)
router.post('/resend-otp', authController.resendForgotPasswordOTP)


router.post('/google', authController.googleAuth);

module.exports = router;