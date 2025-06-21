const express = require('express');
const router = express.Router();
const multer = require('multer');
const reportController = require('../controllers/reportController');
const broadcastController = require('../controllers/broadcastController');
const { protect } = require('../middlewares/authMiddleware');
const authorizeRoles = require('../middlewares/roleMiddleware');
const roles = require('../constants/roles');

const upload = multer({ dest: 'uploads/' });

const cpUpload = upload.fields([
  { name: 'images', maxCount: 10 },
  { name: 'personInvolved[mostRecentPhoto]', maxCount: 1 },
  { name: 'additionalImages', maxCount: 10 },
  { name: 'video', maxCount: 1 }  
]);

// Report Routes
router.post('/create', protect, cpUpload, reportController.createReport);
router.get('/getReports', protect, authorizeRoles(roles.SUPER_ADMIN.role, roles.POLICE_ADMIN.role, roles.POLICE_OFFICER.role), reportController.getReports);
router.put('/update/:reportId', protect, cpUpload, reportController.updateReport);
router.delete('/:reportId', protect, authorizeRoles(roles.SUPER_ADMIN.role), reportController.deleteReport);
router.post('/assign-station', protect, authorizeRoles(roles.POLICE_ADMIN.role), reportController.assignPoliceStation);
router.post('/assign-officer', protect, authorizeRoles(roles.POLICE_ADMIN.role, ), reportController.assignOfficer);
router.put('/update-status/:reportId', protect, reportController.updateUserReport);
router.get('/public-feed', reportController.getPublicFeed);
router.get('/cities', reportController.getReportCities);
router.get('/user-reports', protect, reportController.getUserReports);
router.get('/user-report/:reportId', protect, reportController.getUserReportDetails);
router.get('/search', protect, authorizeRoles( roles.POLICE_OFFICER.role, roles.POLICE_ADMIN.role,  roles.SUPER_ADMIN.role ), reportController.searchReports);

router.get('/public-search', reportController.searchPublicReports)


router.post("/update-absent-to-missing", protect, authorizeRoles(roles.POLICE_OFFICER.role, roles.POLICE_ADMIN.role, roles.SUPER_ADMIN.role), reportController.updateAbsentToMissingReports);

// Broadcast routes
router.post('/broadcast/publish/:reportId', protect, authorizeRoles(roles.POLICE_OFFICER.role, roles.POLICE_ADMIN.role,), broadcastController.publishReport);
router.post('/broadcast/unpublish/:reportId', protect, authorizeRoles(roles.POLICE_OFFICER.role, roles.POLICE_ADMIN.role, ), broadcastController.unpublishReport);
router.get('/broadcast/history/:reportId', protect, authorizeRoles(roles.POLICE_OFFICER.role, roles.POLICE_ADMIN.role), broadcastController.getBroadcastHistory);
router.post('/transfer/:reportId', protect, authorizeRoles(roles.POLICE_OFFICER.role, roles.POLICE_ADMIN.role, roles.SUPER_ADMIN.role),  reportController.transferReport);
// routes/reportRoutes.js
// Add this route
router.post('/archive',  protect,  authorizeRoles(roles.POLICE_OFFICER.role, roles.POLICE_ADMIN.role, roles.CITY_ADMIN.role, roles.SUPER_ADMIN.role), reportController.archiveResolvedReports);
//for testing purposes
router.post('/test-admin', protect, broadcastController.testAdminNotification);
// Add this new route
router.post( "/update-case-ids", reportController.updateAllReportCaseIds );
module.exports = router;