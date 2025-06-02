const express = require('express');
const router = express.Router();
const customPostController = require('../controllers/customPostController');
const { protect } = require('../middlewares/authMiddleware');
const authorizeRoles = require('../middlewares/roleMiddleware');
// Create custom post (with media upload)
router.post('/', 
  protect, 
  authorizeRoles(['police_officer', 'police_admin', 'city_admin', 'super_admin']),
  customPostController.createCustomPost
);

// Get all custom posts
router.get('/', 
  protect, 
  authorizeRoles(['police_officer', 'police_admin', 'city_admin', 'super_admin']),
  customPostController.getCustomPosts
);

// Publish custom post
router.post('/:postId/publish', 
  protect, 
  authorizeRoles(['police_admin', 'city_admin', 'super_admin']),
  customPostController.publishCustomPost
);

// Moderate custom post (approve/reject)
router.patch('/:postId/moderate', 
  protect, 
  authorizeRoles(['police_admin', 'city_admin', 'super_admin']),
  customPostController.moderateCustomPost
);

// Delete custom post
router.delete('/:postId', 
  protect, 
  authorizeRoles(['police_officer', 'police_admin', 'city_admin', 'super_admin']),
  customPostController.deleteCustomPost
);

module.exports = router;