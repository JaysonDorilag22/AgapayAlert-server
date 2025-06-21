const CustomPost = require('../models/customPostModel');
const asyncHandler = require('express-async-handler');
const statusCodes = require('../constants/statusCodes');
const uploadToCloudinary = require('../utils/uploadToCloudinary');
const cloudinary = require('cloudinary').v2;

// Create a new custom post
exports.createCustomPost = asyncHandler(async (req, res) => {
  try {
    const { caption, policeStationId } = req.body;
    const files = req.files;
    
    // Validate required fields
    if (!caption) {
      return res.status(statusCodes.BAD_REQUEST).json({
        success: false,
        msg: 'Caption is required'
      });
    }

    // Process uploaded images
    const images = [];
    if (files && files.length > 0) {
      for (const file of files) {
        const result = await uploadToCloudinary(file.path, 'custom_posts');
        images.push({
          url: result.url,
          public_id: result.public_id
        });
      }
    }

    // Create post
    const customPost = new CustomPost({
      author: req.user.id,
      caption,
      images,
      policeStation: policeStationId || req.user.policeStation,
      status: 'Draft'
    });

    await customPost.save();

    res.status(statusCodes.CREATED).json({
      success: true,
      msg: 'Custom post created successfully',
      data: customPost
    });
  } catch (error) {
    console.error('Error creating custom post:', error);
    res.status(statusCodes.INTERNAL_SERVER_ERROR).json({
      success: false,
      msg: 'Error creating custom post',
      error: error.message
    });
  }
});

// Get all custom posts
exports.getCustomPosts = asyncHandler(async (req, res) => {
  try {
    const { page = 1, limit = 10, status } = req.query;
    let query = {};

    // Filter by status if provided
    if (status) {
      query.status = status;
    }

    // Role-based access control
    if (req.user.roles.includes('police_officer')) {
      // Officers can see posts from their station
      query.policeStation = req.user.policeStation;
    } else if (req.user.roles.includes('police_admin')) {
      // Admins can see posts from their station
      query.policeStation = req.user.policeStation;
    } else if (!req.user.roles.includes('super_admin')) {
      // Non-authorized roles can't see any posts
      return res.status(statusCodes.FORBIDDEN).json({
        success: false,
        msg: 'Not authorized to view custom posts'
      });
    }

    const posts = await CustomPost.find(query)
      .populate('author', 'firstName lastName')
      .populate('policeStation', 'name')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit));

    const total = await CustomPost.countDocuments(query);

    res.status(statusCodes.OK).json({
      success: true,
      data: {
        posts,
        currentPage: parseInt(page),
        totalPages: Math.ceil(total / limit),
        total
      }
    });
  } catch (error) {
    console.error('Error fetching custom posts:', error);
    res.status(statusCodes.INTERNAL_SERVER_ERROR).json({
      success: false,
      msg: 'Error fetching custom posts',
      error: error.message
    });
  }
});

// Update custom post status (publish/draft)
exports.updatePostStatus = asyncHandler(async (req, res) => {
  try {
    const { postId } = req.params;
    const { status } = req.body;

    // Validate status
    if (!['Draft', 'Published'].includes(status)) {
      return res.status(statusCodes.BAD_REQUEST).json({
        success: false,
        msg: 'Invalid status value. Must be Draft or Published.'
      });
    }

    const post = await CustomPost.findById(postId);
    if (!post) {
      return res.status(statusCodes.NOT_FOUND).json({
        success: false,
        msg: 'Custom post not found'
      });
    }

    // Check permissions
    if (post.author.toString() !== req.user.id && 
        !req.user.roles.includes('super_admin') && 
        !req.user.roles.includes('police_admin')) {
      return res.status(statusCodes.FORBIDDEN).json({
        success: false,
        msg: 'Not authorized to update this post'
      });
    }

    post.status = status;
    await post.save();

    res.status(statusCodes.OK).json({
      success: true,
      msg: `Post status updated to ${status}`,
      data: post
    });
  } catch (error) {
    console.error('Error updating post status:', error);
    res.status(statusCodes.INTERNAL_SERVER_ERROR).json({
      success: false,
      msg: 'Error updating post status',
      error: error.message
    });
  }
});

// Delete custom post
exports.deleteCustomPost = asyncHandler(async (req, res) => {
  try {
    const { postId } = req.params;
    
    const post = await CustomPost.findById(postId);
    if (!post) {
      return res.status(statusCodes.NOT_FOUND).json({
        success: false,
        msg: 'Post not found'
      });
    }

    // Check permissions
    if (post.author.toString() !== req.user.id && 
        !req.user.roles.includes('super_admin') && 
        !req.user.roles.includes('police_admin')) {
      return res.status(statusCodes.FORBIDDEN).json({
        success: false,
        msg: 'Not authorized to delete this post'
      });
    }

    // Delete images from Cloudinary
    if (post.images && post.images.length > 0) {
      const deletePromises = post.images.map(image => 
        cloudinary.uploader.destroy(image.public_id)
      );
      await Promise.allSettled(deletePromises);
    }

    await CustomPost.findByIdAndDelete(postId);

    res.status(statusCodes.OK).json({
      success: true,
      msg: 'Custom post deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting custom post:', error);
    res.status(statusCodes.INTERNAL_SERVER_ERROR).json({
      success: false,
      msg: 'Error deleting custom post',
      error: error.message
    });
  }
});

module.exports = exports;