const express = require('express');
const router = express.Router();
const multer = require('multer');
const finderReportController = require('../controllers/reportFindController');
const { protect } = require('../middlewares/authMiddleware');
const authorizeRoles = require('../middlewares/roleMiddleware');
const roles = require('../constants/roles');

const upload = multer({ dest: 'uploads/' });
const cpUpload = upload.fields([{ name: 'images', maxCount: 5 }]);

router.post('/create', protect, cpUpload, finderReportController.createFinderReport);
router.get('/', protect, authorizeRoles(roles.POLICE_OFFICER.role, roles.POLICE_ADMIN.role, roles.CITY_ADMIN.role, roles.SUPER_ADMIN.role), finderReportController.getFinderReports);
router.get('/report/:reportId', protect, finderReportController.getFinderReportsByReportId);
router.get('/:id', protect, finderReportController.getFinderReportById);
router.put('/:id', protect, cpUpload, finderReportController.updateFinderReport);
router.patch('/:id/verify', protect, authorizeRoles(roles.POLICE_OFFICER.role, roles.POLICE_ADMIN.role), finderReportController.verifyFinderReport);
router.delete('/:id', protect, finderReportController.deleteFinderReport);

module.exports = router;