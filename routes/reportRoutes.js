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
  { name: 'personInvolved[mostRecentPhoto]', maxCount: 1 },
  { name: 'additionalImages', maxCount: 10 }
]);

// Middleware to log the fields being received
router.use((req, res, next) => {
  console.log('Received Fields:', Object.keys(req.body));
  console.log('Received Files:', Object.keys(req.files || {}));
  next();
});

router.post('/create', protect, cpUpload, reportController.createReport);
router.put('/update/:reportId', protect, cpUpload, reportController.updateReport);
router.get('/', protect, reportController.getReports);
router.delete('/:reportId', protect, reportController.deleteReport);
router.post('/assign', protect, reportController.assignPoliceStation);

module.exports = router;