// controllers/reviewController.js
const Review = require('../models/Review');
const User = require('../models/User');

// @desc    Get all reviews and calculated rating stats for a user
// @route   GET /api/reviews/user/:userId
// @access  Public
const getUserReviews = async (req, res) => {
  try {
    const { userId } = req.params;

    const reviews = await Review.find({ recipient: userId })
      .populate('reviewer', 'firstName lastName profilePicture')
      .sort({ createdAt: -1 });

    const totalReviews = reviews.length;
    let averageRating = 0;

    if (totalReviews > 0) {
      const sum = reviews.reduce((acc, curr) => acc + curr.rating, 0);
      averageRating = Number((sum / totalReviews).toFixed(1));
    }

    return res.status(200).json({
      success: true,
      data: {
        totalReviews,
        averageRating,
        reviews,
      },
    });
  } catch (error) {
    console.error('Error fetching user reviews:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error fetching user reviews',
      error: error.message,
    });
  }
};

// @desc    Create a new rating & review for a user
// @route   POST /api/reviews
// @access  Private
const createReview = async (req, res) => {
  try {
    const { recipientId, rating, comment, activityType } = req.body;

    if (!recipientId || !rating) {
      return res.status(400).json({
        success: false,
        message: 'Recipient ID and rating score (1-5) are required',
      });
    }

    if (recipientId.toString() === req.user._id.toString()) {
      return res.status(400).json({
        success: false,
        message: 'Users cannot review themselves',
      });
    }

    const recipient = await User.findById(recipientId);
    if (!recipient) {
      return res.status(404).json({
        success: false,
        message: 'Recipient user not found',
      });
    }

    const numRating = Number(rating);
    if (isNaN(numRating) || numRating < 1 || numRating > 5) {
      return res.status(400).json({
        success: false,
        message: 'Rating must be a number between 1 and 5',
      });
    }

    const newReview = await Review.create({
      reviewer: req.user._id,
      recipient: recipientId,
      rating: numRating,
      comment: comment || '',
      activityType: activityType || 'companionship',
    });

    const populatedReview = await Review.findById(newReview._id)
      .populate('reviewer', 'firstName lastName profilePicture');

    return res.status(201).json({
      success: true,
      message: 'Review created successfully',
      data: populatedReview,
    });
  } catch (error) {
    console.error('Error creating review:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error creating review',
      error: error.message,
    });
  }
};

module.exports = {
  getUserReviews,
  createReview,
};
