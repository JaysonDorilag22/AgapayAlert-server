const express = require('express');
const router = express.Router();
const customPostController = require('../controllers/customPostController');
const { protect } = require('../middlewares/authMiddleware');
const authorizeRoles = require('../middlewares/roleMiddleware');
const multer = require('multer');

// Configure multer for file uploads
const upload = multer({ dest: 'uploads/' });

// Create custom post (with media upload)
router.post('/', 
  protect, 
  authorizeRoles(['police_officer', 'police_admin', 'city_admin', 'super_admin']),
  upload.array('images', 5), // Allow up to 5 images
  customPostController.createCustomPost
);

// Get all custom posts
router.get('/', 
  protect, 
  authorizeRoles(['police_officer', 'police_admin', 'city_admin', 'super_admin']),
  customPostController.getCustomPosts
);

// Update post status (Draft/Published)
router.patch('/:postId/status', 
  protect, 
  authorizeRoles(['police_officer', 'police_admin', 'city_admin', 'super_admin']),
  customPostController.updatePostStatus
);

// Delete custom post
router.delete('/:postId', 
  protect, 
  authorizeRoles(['police_officer', 'police_admin', 'city_admin', 'super_admin']),
  customPostController.deleteCustomPost
);

module.exports = router;