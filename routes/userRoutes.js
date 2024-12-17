const express = require('express');
const router = express.Router();
const multer = require('multer');
const userController = require('../controllers/userController');
const { protect } = require('../middlewares/authMiddleware');
const authorizeRoles = require('../middlewares/roleMiddleware');
const roles = require('../constants/roles');

const upload = multer({ dest: 'uploads/' });

router.get('/:userId', protect,  userController.getUserDetails);
router.put('/:userId', protect, upload.single('avatar'), userController.updateUserDetails);
router.put('/change-password/:userId', protect, userController.changePassword);
router.delete('/:userId', protect, userController.deleteUser);
router.post('/create', protect, authorizeRoles(roles.SUPER_ADMIN.role), upload.single('avatar'), userController.createUserWithRole);


module.exports = router;