const express = require('express');
const router = express.Router();
const multer = require('multer');
const reportController = require('../controllers/reportController');
const { protect } = require('../middlewares/authMiddleware');
const authorizeRoles = require('../middlewares/roleMiddleware');
const roles = require('../constants/roles');

const upload = multer({ dest: 'uploads/' });

const cpUpload = upload.fields([
  { name: 'images', maxCount: 10 },
  { name: 'personInvolved[mostRecentPhoto]', maxCount: 1 }
]);

// Create a new report
router.post('/', protect, authorizeRoles(roles.USER.role), cpUpload, reportController.createReport);

// Update a report
router.put('/:reportId', protect, authorizeRoles(roles.POLICE_OFFICER.role, roles.POLICE_ADMIN.role), upload.array('additionalImages'), reportController.updateReport);

// Retrieve reports
router.get('/', protect, authorizeRoles(roles.USER.role, roles.POLICE_OFFICER.role, roles.POLICE_ADMIN.role, roles.CITY_ADMIN.role, roles.SUPER_ADMIN.role), reportController.getReports);

// Delete a report
router.delete('/:reportId', protect, authorizeRoles(roles.POLICE_ADMIN.role, roles.SUPER_ADMIN.role), reportController.deleteReport);

// Assign a police station to a report
router.post('/assign', protect, authorizeRoles(roles.POLICE_ADMIN.role, roles.SUPER_ADMIN.role), reportController.assignPoliceStation);

module.exports = router;