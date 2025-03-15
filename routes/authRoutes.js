const express = require("express");
const router = express.Router();
const multer = require("multer");
const passport = require("passport");
const { protect } = require("../middlewares/authMiddleware");
const authController = require("../controllers/authController");

const upload = multer({ dest: "uploads/" });

router.post(
  "/register",
  upload.fields([
    { name: "avatar", maxCount: 1 },
    { name: "card", maxCount: 1 },
  ]),
  authController.register
);
router.post("/verify-account", authController.verifyAccount);
router.post("/login", authController.login);
router.post("/forgot-password", authController.forgotPassword);
router.post("/reset-password", authController.resetPassword);
router.post("/logout", authController.logout);
router.post("/resend-verification", authController.resendVerification);
router.post("/resend-otp", authController.resendForgotPasswordOTP);
router.post("/update-device-token", protect, authController.updateDeviceToken);

router.post("/google", authController.googleAuth);

module.exports = router;
