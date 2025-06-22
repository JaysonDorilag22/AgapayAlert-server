const express = require('express');
const router = express.Router();
const customPostController = require('../controllers/customPostController');
const { protect } = require('../middlewares/authMiddleware');
const authorizeRoles = require('../middlewares/roleMiddleware');
const multer = require('multer');

// Configure multer for file uploads
const upload = multer({ dest: 'uploads/' });

// Create custom post (with media upload)
router.post('/create', 
  protect, 
  upload.array('images', 5), // Allow up to 5 images
  customPostController.createCustomPost
);

// Get all custom posts
router.get('/', 
  protect, 
  customPostController.getCustomPosts
);

router.get('/public', customPostController.getPublicCustomPosts);

// Update post status (Draft/Published)
router.patch('/:postId/status', 
  protect, 
  customPostController.updatePostStatus
);

// Delete custom post
router.delete('/:postId', 
  protect, 
  customPostController.deleteCustomPost
);

module.exports = router;