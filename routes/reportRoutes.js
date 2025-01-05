const express = require('express');
const router = express.Router();
const multer = require('multer');
const reportController = require('../controllers/reportController');
const { protect } = require('../middlewares/authMiddleware');
const authorizeRoles = require('../middlewares/roleMiddleware');
const roles = require('../constants/roles');

const upload = multer({ dest: 'uploads/' });

// Configure multiple file upload fields
const cpUpload = upload.fields([
  { name: 'images', maxCount: 10 },
  { name: 'personInvolved[mostRecentPhoto]', maxCount: 1 },
  { name: 'additionalImages', maxCount: 10 }
]);

// Debug middleware
router.use((req, res, next) => {
  console.log('Received Fields:', Object.keys(req.body));
  console.log('Received Files:', Object.keys(req.files || {}));
  next();
});

// Report Routes
router.post('/create', protect, cpUpload, reportController.createReport);
router.get('/', protect, reportController.getReports);
router.put('/update/:reportId', protect, cpUpload, reportController.updateReport);
router.delete('/:reportId', protect, authorizeRoles(roles.SUPER_ADMIN.role), reportController.deleteReport);
router.post('/assign-station', protect, authorizeRoles(roles.POLICE_ADMIN.role), reportController.assignPoliceStation);
router.post('/assign-officer', protect, authorizeRoles(roles.POLICE_ADMIN.role), reportController.assignOfficer);
router.put('/update-status/:reportId', protect, reportController.updateUserReport);
router.get('/public-feed', protect, reportController.getPublicFeed);
router.get('/cities', reportController.getReportCities);
router.get('/user-reports', protect, reportController.getUserReports);

module.exports = router;