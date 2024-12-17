const express = require('express');
const router = express.Router();
const multer = require('multer');
const policeStationController = require('../controllers/policeStationController');
const { protect } = require('../middlewares/authMiddleware');
const authorizeRoles = require('../middlewares/roleMiddleware');
const roles = require('../constants/roles');

const upload = multer({ dest: 'uploads/' });

router.post('/', protect, authorizeRoles(roles.SUPER_ADMIN.role), upload.single('image'), policeStationController.createPoliceStation);
router.get('/', protect, policeStationController.getPoliceStations);
router.get('/:policeStationId', protect, policeStationController.getPoliceStationById);
router.put('/:policeStationId', protect, authorizeRoles(roles.SUPER_ADMIN.role), upload.single('image'), policeStationController.updatePoliceStation);
router.delete('/:policeStationId', protect, authorizeRoles(roles.SUPER_ADMIN.role), policeStationController.deletePoliceStation);

module.exports = router;