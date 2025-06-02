const CustomPost = require('../models/customPostModel');
const User = require('../models/userModel');
const PoliceStation = require('../models/policeStationModel');
const asyncHandler = require('express-async-handler');
const statusCodes = require('../constants/statusCodes');
const uploadToCloudinary = require('../utils/uploadToCloudinary');
const cloudinary = require('cloudinary').v2;
const axios = require('axios');
const { sendMessengerBroadcast } = require('../utils/messengerUtils');

// Create a new custom post
exports.createCustomPost = asyncHandler(async (req, res) => {
  try {
    const {
      title,
      content,
      category,
      priority,
      targetAudience,
      tags,
      visibility,
      scheduledDate,
      mediaUrls // Accept media URLs directly if provided
    } = req.body;

    const userId = req.user.id;
    const userRole = req.user.roles[0];

    // Validate user permissions
    if (!['police_officer', 'police_admin', 'city_admin', 'super_admin'].includes(userRole)) {
      return res.status(statusCodes.FORBIDDEN).json({
        success: false,
        msg: 'Not authorized to create posts'
      });
    }

    // Handle media URLs if provided (instead of file uploads)
    let media = [];
    if (mediaUrls && Array.isArray(mediaUrls)) {
      media = mediaUrls.map(url => ({
        type: 'image', // Default to image, you can modify this
        url: url,
        public_id: 'external_media', // Since it's not uploaded to Cloudinary
        caption: ''
      }));
    }

    // Set default status based on user role
    let status = 'Draft';
    if (['city_admin', 'super_admin'].includes(userRole)) {
      status = 'Published'; // Auto-approve for higher roles
    } else {
      status = 'Pending Approval'; // Require approval for officers
    }

    const customPost = new CustomPost({
      author: userId,
      title,
      content,
      category,
      priority,
      targetAudience,
      media,
      tags: tags ? tags.split(',').map(tag => tag.trim()) : [],
      status,
      visibility,
      policeStation: req.user.policeStation,
      city: req.user.address?.city,
      scheduledDate: scheduledDate ? new Date(scheduledDate) : null,
      isScheduled: !!scheduledDate
    });

    await customPost.save();
    await customPost.populate('author', 'firstName lastName roles');
    await customPost.populate('policeStation', 'name');

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

// Get all custom posts with filters
exports.getCustomPosts = asyncHandler(async (req, res) => {
  try {
    const {
      status,
      category,
      priority,
      visibility,
      page = 1,
      limit = 10,
      search
    } = req.query;

    const userRole = req.user.roles[0];
    let query = {};

    // Build query based on user role
    switch (userRole) {
      case 'police_officer':
        query.$or = [
          { author: req.user.id },
          { policeStation: req.user.policeStation, status: 'Published' }
        ];
        break;
      case 'police_admin':
        query.policeStation = req.user.policeStation;
        break;
      case 'city_admin':
        query.city = req.user.address.city;
        break;
      case 'super_admin':
        // No restrictions
        break;
      default:
        return res.status(statusCodes.FORBIDDEN).json({
          success: false,
          msg: 'Not authorized to view posts'
        });
    }

    // Apply filters
    if (status) query.status = status;
    if (category) query.category = category;
    if (priority) query.priority = priority;
    if (visibility) query.visibility = visibility;

    // Search functionality
    if (search) {
      query.$or = [
        { title: { $regex: search, $options: 'i' } },
        { content: { $regex: search, $options: 'i' } },
        { tags: { $in: [new RegExp(search, 'i')] } }
      ];
    }

    const posts = await CustomPost.find(query)
      .populate('author', 'firstName lastName roles')
      .populate('policeStation', 'name')
      .populate('approvedBy', 'firstName lastName')
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

// Publish custom post to Facebook and/or Messenger
exports.publishCustomPost = asyncHandler(async (req, res) => {
  try {
    const { postId } = req.params;
    const { platforms } = req.body; // ['Facebook', 'Messenger'] or ['Facebook'] or ['Messenger']

    const post = await CustomPost.findById(postId).populate('author');
    if (!post) {
      return res.status(statusCodes.NOT_FOUND).json({
        success: false,
        msg: 'Post not found'
      });
    }

    // Check permissions
    const userRole = req.user.roles[0];
    if (!['city_admin', 'super_admin'].includes(userRole) && post.author._id.toString() !== req.user.id) {
      return res.status(statusCodes.FORBIDDEN).json({
        success: false,
        msg: 'Not authorized to publish this post'
      });
    }

    const results = {};
    let hasErrors = false;

    // Publish to Facebook
    if (platforms.includes('Facebook')) {
      try {
        const facebookResult = await publishToFacebook(post);
        results.facebook = facebookResult;
        
        if (facebookResult.success) {
          post.facebookPostId = facebookResult.postId;
        } else {
          hasErrors = true;
        }
      } catch (error) {
        results.facebook = { success: false, error: error.message };
        hasErrors = true;
      }
    }

    // Publish to Messenger
    if (platforms.includes('Messenger')) {
      try {
        const messengerResult = await publishToMessenger(post);
        results.messenger = messengerResult;
        
        if (messengerResult.success) {
          post.publishingDetails.messengerBroadcastStats = {
            sentCount: messengerResult.count || 0,
            deliveredCount: messengerResult.count || 0,
            failedCount: 0
          };
        } else {
          hasErrors = true;
        }
      } catch (error) {
        results.messenger = { success: false, error: error.message };
        hasErrors = true;
      }
    }

    // Update post status and details
    post.status = 'Published';
    post.publishedDate = new Date();
    post.publishingDetails.platforms = platforms;
    
    if (hasErrors) {
      post.publishingDetails.errorLog = JSON.stringify(results);
    }

    await post.save();

    res.status(statusCodes.OK).json({
      success: true,
      msg: 'Post published successfully',
      data: {
        post,
        publishResults: results
      }
    });

  } catch (error) {
    console.error('Error publishing custom post:', error);
    res.status(statusCodes.INTERNAL_SERVER_ERROR).json({
      success: false,
      msg: 'Error publishing custom post',
      error: error.message
    });
  }
});

// Approve/Reject custom post
exports.moderateCustomPost = asyncHandler(async (req, res) => {
  try {
    const { postId } = req.params;
    const { action, feedback } = req.body; // action: 'approve' or 'reject'

    const userRole = req.user.roles[0];
    if (!['police_admin', 'city_admin', 'super_admin'].includes(userRole)) {
      return res.status(statusCodes.FORBIDDEN).json({
        success: false,
        msg: 'Not authorized to moderate posts'
      });
    }

    const post = await CustomPost.findById(postId);
    if (!post) {
      return res.status(statusCodes.NOT_FOUND).json({
        success: false,
        msg: 'Post not found'
      });
    }

    if (action === 'approve') {
      post.status = 'Published';
      post.approvedBy = req.user.id;
      post.approvalDate = new Date();
    } else if (action === 'reject') {
      post.status = 'Draft';
      if (feedback) {
        post.publishingDetails.errorLog = feedback;
      }
    }

    await post.save();

    res.status(statusCodes.OK).json({
      success: true,
      msg: `Post ${action}d successfully`,
      data: post
    });

  } catch (error) {
    console.error('Error moderating custom post:', error);
    res.status(statusCodes.INTERNAL_SERVER_ERROR).json({
      success: false,
      msg: 'Error moderating custom post',
      error: error.message
    });
  }
});

// Helper function to publish to Facebook
async function publishToFacebook(post) {
  try {
    const FB_API_BASE = 'https://graph.facebook.com/v22.0';
    
    if (post.media && post.media.length > 0) {
      // Post with media
      const response = await axios.post(
        `${FB_API_BASE}/${process.env.FACEBOOK_PAGE_ID}/photos`,
        {
          caption: post.formattedContent,
          url: post.media[0].url,
          access_token: process.env.FACEBOOK_PAGE_ACCESS_TOKEN
        }
      );
      
      return {
        success: true,
        postId: response.data.id,
        data: response.data
      };
    } else {
      // Text-only post
      const response = await axios.post(
        `${FB_API_BASE}/${process.env.FACEBOOK_PAGE_ID}/feed`,
        {
          message: post.formattedContent,
          access_token: process.env.FACEBOOK_PAGE_ACCESS_TOKEN
        }
      );
      
      return {
        success: true,
        postId: response.data.id,
        data: response.data
      };
    }
  } catch (error) {
    console.error('Facebook publishing error:', error.response?.data || error);
    return {
      success: false,
      error: error.response?.data?.error?.message || error.message
    };
  }
}

// Helper function to publish to Messenger
async function publishToMessenger(post) {
  try {
    // Use existing messenger broadcast utility
    const mockReport = {
      type: post.category,
      personInvolved: {
        firstName: 'Custom',
        lastName: 'Post'
      },
      location: {
        address: {
          city: post.city || 'General'
        }
      }
    };

    // Custom message for messenger broadcast
    const customMessage = {
      attachment: {
        type: "template",
        payload: {
          template_type: "generic",
          elements: [{
            title: post.title,
            subtitle: post.content.substring(0, 80) + (post.content.length > 80 ? '...' : ''),
            image_url: post.media && post.media.length > 0 ? post.media[0].url : 'https://agapayalert-web.onrender.com/assets/AGAPAYALERT%20-%20imagotype-CfBGhIL1.svg',
            buttons: [
              {
                type: "web_url",
                url: "https://agapayalert-web.onrender.com/",
                title: "Visit Website"
              }
            ]
          }]
        }
      }
    };

    // Get messenger subscribers and broadcast
    const subscribersResponse = await axios.get(
      `https://graph.facebook.com/v22.0/${process.env.FACEBOOK_PAGE_ID}/conversations`,
      {
        params: {
          access_token: process.env.FACEBOOK_PAGE_ACCESS_TOKEN,
          fields: "participants"
        }
      }
    );

    const subscribers = subscribersResponse.data.data.map(conv => 
      conv.participants.data[0].id
    );

    if (subscribers.length === 0) {
      return { success: false, msg: 'No messenger subscribers found' };
    }

    // Send to all subscribers
    const sendPromises = subscribers.map(psid =>
      axios.post(
        'https://graph.facebook.com/v22.0/me/messages',
        {
          recipient: { id: psid },
          message: customMessage,
          messaging_type: "MESSAGE_TAG",
          tag: "CONFIRMED_EVENT_UPDATE"
        },
        {
          params: { access_token: process.env.FACEBOOK_PAGE_ACCESS_TOKEN }
        }
      )
    );

    await Promise.allSettled(sendPromises);

    return {
      success: true,
      count: subscribers.length,
      msg: `Custom post sent to ${subscribers.length} messenger subscribers`
    };

  } catch (error) {
    console.error('Messenger publishing error:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

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
    const userRole = req.user.roles[0];
    if (!['super_admin'].includes(userRole) && post.author.toString() !== req.user.id) {
      return res.status(statusCodes.FORBIDDEN).json({
        success: false,
        msg: 'Not authorized to delete this post'
      });
    }

    // Delete media from Cloudinary
    if (post.media && post.media.length > 0) {
      const deletePromises = post.media.map(media => 
        cloudinary.uploader.destroy(media.public_id)
      );
      await Promise.allSettled(deletePromises);
    }

    // Delete Facebook post if exists
    if (post.facebookPostId) {
      try {
        await axios.delete(
          `https://graph.facebook.com/v22.0/${post.facebookPostId}`,
          {
            params: { access_token: process.env.FACEBOOK_PAGE_ACCESS_TOKEN }
          }
        );
      } catch (fbError) {
        console.error('Error deleting Facebook post:', fbError);
      }
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

module.exports = {
  createCustomPost: exports.createCustomPost,
  getCustomPosts: exports.getCustomPosts,
  publishCustomPost: exports.publishCustomPost,
  moderateCustomPost: exports.moderateCustomPost,
  deleteCustomPost: exports.deleteCustomPost
};