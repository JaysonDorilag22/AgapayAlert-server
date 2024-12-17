const express = require('express');
const router = express.Router();
const multer = require('multer');
const cityController = require('../controllers/cityController');
const { protect } = require('../middlewares/authMiddleware');
const authorizeRoles = require('../middlewares/roleMiddleware');
const roles = require('../constants/roles');

const upload = multer({ dest: 'uploads/' });

router.post('/', protect, authorizeRoles(roles.SUPER_ADMIN.role), upload.single('image'), cityController.createCity);
router.get('/', protect, cityController.getCities);
router.get('/:cityId', protect, cityController.getCityById);
router.put('/:cityId', protect, authorizeRoles(roles.SUPER_ADMIN.role), upload.single('image'), cityController.updateCity);
router.delete('/:cityId', protect, authorizeRoles(roles.SUPER_ADMIN.role), cityController.deleteCity);

module.exports = router;