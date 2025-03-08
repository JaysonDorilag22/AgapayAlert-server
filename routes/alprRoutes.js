const express = require('express');
const router = express.Router();
const multer = require('multer');
const alprController = require('../controllers/alprController');
const { protect } = require('../middlewares/authMiddleware');
const authorizeRoles = require('../middlewares/roleMiddleware');
const roles = require('../constants/roles');

// Configure multer for image upload
const upload = multer({ dest: 'uploads/' });

// ALPR Routes
router.post('/scan', protect, authorizeRoles(roles.POLICE_OFFICER.role, roles.POLICE_ADMIN.role, roles.CITY_ADMIN.role, roles.SUPER_ADMIN.role),  upload.single('image'), alprController.scanPlate);

router.get('/scans', protect, authorizeRoles(roles.POLICE_OFFICER.role, roles.POLICE_ADMIN.role, roles.CITY_ADMIN.role, roles.SUPER_ADMIN.role), alprController.getAllScans);

router.get('/scans/:id', protect, authorizeRoles(roles.POLICE_OFFICER.role, roles.POLICE_ADMIN.role, roles.CITY_ADMIN.role, roles.SUPER_ADMIN.role), alprController.getScanById);

router.post('/scans/:scanId/link/:reportId', protect, authorizeRoles(roles.POLICE_OFFICER.role, roles.POLICE_ADMIN.role , roles.CITY_ADMIN.role, roles.SUPER_ADMIN.role), alprController.linkToReport);

router.delete('/scans/:id', protect, authorizeRoles(roles.POLICE_ADMIN.role, roles.CITY_ADMIN.role, roles.SUPER_ADMIN.role), alprController.deleteScan);


router.post('/test-scan', upload.single('image'), alprController.testScan);
module.exports = router;