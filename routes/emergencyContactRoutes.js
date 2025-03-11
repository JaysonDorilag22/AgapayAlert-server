const express = require('express');
const router = express.Router();
const emergencyContactController = require('../controllers/emergencyContactController');
const { protect } = require('../middlewares/authMiddleware');
const authorizeRoles = require('../middlewares/roleMiddleware');
const roles = require('../constants/roles');

// Public routes - accessible without authentication
router.get('/', emergencyContactController.getAllEmergencyContacts);
router.get('/nearest', emergencyContactController.getNearestEmergencyContacts);
router.get('/:contactId', emergencyContactController.getEmergencyContactById);

// Protected routes - only authorized users can modify data
router.post('/create',  emergencyContactController.createEmergencyContact);
// router.post('/create', protect, authorizeRoles(roles.SUPER_ADMIN.role, roles.CITY_ADMIN.role), emergencyContactController.createEmergencyContact);

router.put('/:contactId', protect, authorizeRoles(roles.SUPER_ADMIN.role, roles.CITY_ADMIN.role), emergencyContactController.updateEmergencyContact);
router.delete('/:contactId', protect, authorizeRoles(roles.SUPER_ADMIN.role, roles.CITY_ADMIN.role), emergencyContactController.deleteEmergencyContact);

module.exports = router;