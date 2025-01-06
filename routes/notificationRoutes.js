const express = require('express');
const router = express.Router();
const notificationController = require('../controllers/notificationController');
const { protect } = require('../middlewares/authMiddleware');

router.get('/', protect, notificationController.getUserNotifications);
router.patch('/:notificationId/read', protect, notificationController.markAsRead);
router.patch('/mark-all-read', protect, notificationController.markAllAsRead);

module.exports = router;