const express = require('express');
const router = express.Router();
const multer = require('multer');
const userController = require('../controllers/userController');
const { protect } = require('../middlewares/authMiddleware');

const upload = multer({ dest: 'uploads/' });

// User routes
router.get('/:userId', protect,  userController.getUserDetails);
router.put('/:userId', protect, upload.single('avatar'), userController.updateUserDetails);
router.put('/change-password/:userId', protect, userController.changePassword);
router.delete('/:userId', protect, userController.deleteUser);

module.exports = router;