const Feedback = require('../models/feedbackModel');
const asyncHandler = require('express-async-handler');
const statusCodes = require('../constants/statusCodes');

// Create feedback
exports.createFeedback = asyncHandler(async (req, res) => {
    const { rating, category, comment } = req.body;

    // Validate and ensure rating is a number
    if (isNaN(rating) || rating < 1 || rating > 5) {
        return res.status(400).json({
            success: false,
            message: "Rating must be a number between 1 and 5",
        });
    }

    const feedback = await Feedback.create({
        rating: parseFloat(rating), // Ensure numeric value
        category,
        comment,
        user: req.user.id,
    });

    res.status(statusCodes.CREATED).json({
        success: true,
        data: feedback,
    });
});


// Get all feedbacks
exports.getFeedbacks = asyncHandler(async (req, res) => {
    const { page = 1, limit = 10, category, status } = req.query;
    const query = {};

    if (category) query.category = category;
    if (status) query.status = status;

    const feedbacks = await Feedback.find(query)
        .populate('user', 'firstName lastName email')
        .populate('reportId')
        .populate('adminResponse.respondedBy', 'firstName lastName')
        .sort('-createdAt')
        .skip((page - 1) * limit)
        .limit(Number(limit));

    const total = await Feedback.countDocuments(query);

    res.status(statusCodes.OK).json({
        success: true,
        data: {
            feedbacks,
            currentPage: Number(page),
            totalPages: Math.ceil(total / limit),
            total
        }
    });
});

// Get single feedback
exports.getFeedback = asyncHandler(async (req, res) => {
    const feedback = await Feedback.findById(req.params.id)
        .populate('user', 'firstName lastName email')
        .populate('reportId')
        .populate('adminResponse.respondedBy', 'firstName lastName');

    if (!feedback) {
        return res.status(statusCodes.NOT_FOUND).json({
            success: false,
            msg: 'Feedback not found'
        });
    }

    res.status(statusCodes.OK).json({
        success: true,
        data: feedback
    });
});

// Get logged-in user's feedbacks
exports.getMyFeedback = asyncHandler(async (req, res) => {
    const { page = 1, limit = 10, category } = req.query;
    
    // Build query
    const query = { user: req.user.id };
    if (category) {
        query.category = category;
    }
    
    const feedbacks = await Feedback.find(query)
        .populate('reportId')
        .populate('adminResponse.respondedBy', 'firstName lastName')
        .sort('-createdAt')
        .skip((page - 1) * limit)
        .limit(Number(limit));

    const total = await Feedback.countDocuments(query);

    res.status(statusCodes.OK).json({
        success: true,
        data: {
            feedbacks,
            currentPage: Number(page),
            totalPages: Math.ceil(total / limit),
            total,
            category: category || 'all'
        }
    });
});
// Update feedback
exports.updateFeedback = asyncHandler(async (req, res) => {
    const feedback = await Feedback.findById(req.params.id);

    if (!feedback) {
        return res.status(statusCodes.NOT_FOUND).json({
            success: false,
            msg: 'Feedback not found'
        });
    }

    // Check if user owns the feedback
    if (feedback.user.toString() !== req.user.id) {
        return res.status(statusCodes.FORBIDDEN).json({
            success: false,
            msg: 'Not authorized to update this feedback'
        });
    }

    const updatedFeedback = await Feedback.findByIdAndUpdate(
        req.params.id,
        req.body,
        { new: true, runValidators: true }
    );

    res.status(statusCodes.OK).json({
        success: true,
        data: updatedFeedback
    });
});

// Delete feedback 
exports.deleteFeedback = asyncHandler(async (req, res) => {
    const feedback = await Feedback.findById(req.params.id);

    if (!feedback) {
        return res.status(statusCodes.NOT_FOUND).json({
            success: false,
            msg: 'Feedback not found'
        });
    }

    if (feedback.user.toString() !== req.user.id && !req.user.roles.includes('admin')) {
        return res.status(statusCodes.FORBIDDEN).json({
            success: false,
            msg: 'Not authorized to delete this feedback'
        });
    }

    await feedback.deleteOne();

    res.status(statusCodes.OK).json({
        success: true,
        msg: 'Feedback deleted successfully'
    });
});

// Admin response to feedback
exports.respondToFeedback = asyncHandler(async (req, res) => {
    const { comment, status } = req.body;

    if (!req.user.roles.includes('admin')) {
        return res.status(statusCodes.FORBIDDEN).json({
            success: false,
            msg: 'Only admins can respond to feedback'
        });
    }

    const feedback = await Feedback.findByIdAndUpdate(
        req.params.id,
        {
            status,
            adminResponse: {
                comment,
                respondedBy: req.user.id,
                respondedAt: Date.now()
            }
        },
        { new: true }
    );

    if (!feedback) {
        return res.status(statusCodes.NOT_FOUND).json({
            success: false,
            msg: 'Feedback not found'
        });
    }

    res.status(statusCodes.OK).json({
        success: true,
        data: feedback
    });
});

// Get feedback statistics
exports.getFeedbackStats = asyncHandler(async (req, res) => {
    const stats = await Feedback.aggregate([
        {
            $group: {
                _id: null,
                averageRating: { $avg: '$rating' },
                totalFeedback: { $sum: 1 },
                categoryStats: {
                    $push: {
                        category: '$category',
                        rating: '$rating'
                    }
                }
            }
        }
    ]);

    const categoryAverages = {};
    if (stats[0]) {
        stats[0].categoryStats.forEach(item => {
            if (!categoryAverages[item.category]) {
                categoryAverages[item.category] = {
                    total: 0,
                    sum: 0
                };
            }
            categoryAverages[item.category].total += 1;
            categoryAverages[item.category].sum += item.rating;
        });
    }

    const formattedStats = {
        overall: stats[0] ? Math.round(stats[0].averageRating * 10) / 10 : 0,
        total: stats[0] ? stats[0].totalFeedback : 0,
        byCategory: Object.keys(categoryAverages).reduce((acc, cat) => {
            acc[cat] = Math.round((categoryAverages[cat].sum / categoryAverages[cat].total) * 10) / 10;
            return acc;
        }, {})
    };

    res.status(statusCodes.OK).json({
        success: true,
        data: formattedStats
    });
});