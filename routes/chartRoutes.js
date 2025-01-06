const express = require('express');
const router = express.Router();
const chartController = require('../controllers/chartController');
const { protect } = require('../middlewares/authMiddleware');
const authorizeRoles = require('../middlewares/roleMiddleware');
const roles = require('../constants/roles');

// Protect all routes and allow only authorized roles
router.use(protect);
router.use(authorizeRoles(
  roles.POLICE_OFFICER.role,
  roles.POLICE_ADMIN.role, 
  roles.CITY_ADMIN.role,
  roles.SUPER_ADMIN.role
));

// Chart routes
router.get('/type-distribution', chartController.getTypeDistribution);
router.get('/status-distribution', chartController.getStatusDistribution);
router.get('/monthly-trend', chartController.getMonthlyTrend);
router.get('/location-hotspots', chartController.getLocationHotspots);

module.exports = router;