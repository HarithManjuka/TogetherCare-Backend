// controllers/reviewController.js
const Review = require('../models/Review');
const User = require('../models/User');
const CompanionshipRequest = require('../models/CompanionshipRequest');
const HelpRequest = require('../models/HelpRequest');
const jwt = require('jsonwebtoken');

// Helper to optionally extract authenticated user from bearer token
const getAuthUserFromReq = async (req) => {
  if (req.user) return req.user;
  if (req.headers && req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    try {
      const token = req.headers.authorization.split(' ')[1];
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const user = await User.findById(decoded.id).select('-password');
      return user;
    } catch (err) {
      return null;
    }
  }
  return null;
};

// @desc    Get all reviews and calculated rating stats for a user
// @route   GET /api/reviews/user/:userId
// @access  Public (Sanitized) / Authenticated (Full details for self)
const getUserReviews = async (req, res) => {
  try {
    const { userId } = req.params;
    const authUser = await getAuthUserFromReq(req);
    const isOwnProfile = Boolean(
      authUser && (authUser._id.toString() === userId.toString() || authUser.role === 'admin')
    );

    const rawReviews = await Review.find({ recipient: userId })
      .populate('reviewer', 'firstName lastName profilePicture phone email dateOfBirth age address verificationBadgeStatus isEmailVerified role customId')
      .sort({ createdAt: -1 });

    const totalReviews = rawReviews.length;
    let averageRating = 0;

    if (totalReviews > 0) {
      const sum = rawReviews.reduce((acc, curr) => acc + curr.rating, 0);
      averageRating = Number((sum / totalReviews).toFixed(1));
    }

    // Process each review with schedule details & privacy filtering
    const formattedReviews = await Promise.all(
      rawReviews.map(async (rev) => {
        let visitDetails = null;

        // Fetch schedule / visit details if scheduleId exists or match by reviewer/recipient/activity
        if (rev.scheduleId) {
          if (rev.scheduleModel === 'HelpRequest') {
            visitDetails = await HelpRequest.findById(rev.scheduleId).select('serviceType date time location feedback status createdAt');
          } else {
            visitDetails = await CompanionshipRequest.findById(rev.scheduleId).select('activityType scheduledDate timeSlot location notes communicationMethod status createdAt');
          }
        }

        const reviewerObj = rev.reviewer || {};

        if (isOwnProfile) {
          // Volunteer viewing their own reviews: can see full elder details & visit details to connect
          return {
            _id: rev._id,
            rating: rev.rating,
            comment: rev.comment,
            activityType: rev.activityType,
            visitRating: rev.visitRating,
            visitReview: rev.visitReview,
            createdAt: rev.createdAt,
            reviewer: {
              _id: reviewerObj._id,
              firstName: reviewerObj.firstName,
              lastName: reviewerObj.lastName,
              name: `${reviewerObj.firstName || ''} ${reviewerObj.lastName || ''}`.trim(),
              profilePicture: reviewerObj.profilePicture,
              phone: reviewerObj.phone,
              email: reviewerObj.email,
              age: reviewerObj.age,
              address: reviewerObj.address,
              verificationBadgeStatus: reviewerObj.verificationBadgeStatus,
              isEmailVerified: reviewerObj.isEmailVerified,
              role: reviewerObj.role,
            },
            visitDetails: visitDetails || {
              activityType: rev.activityType,
              status: 'completed',
            },
          };
        } else {
          // Others (seniors browsing volunteer): only see public elder name & review comment
          return {
            _id: rev._id,
            rating: rev.rating,
            comment: rev.comment,
            activityType: rev.activityType,
            createdAt: rev.createdAt,
            reviewer: {
              _id: reviewerObj._id,
              firstName: reviewerObj.firstName,
              lastName: reviewerObj.lastName,
              name: `${reviewerObj.firstName || ''} ${reviewerObj.lastName || ''}`.trim(),
              profilePicture: reviewerObj.profilePicture,
              verificationBadgeStatus: reviewerObj.verificationBadgeStatus,
              isEmailVerified: reviewerObj.isEmailVerified,
            },
            // Private visit details and private contact info are stripped
          };
        }
      })
    );

    return res.status(200).json({
      success: true,
      data: {
        isOwnProfile,
        totalReviews,
        averageRating,
        reviews: formattedReviews,
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

// @desc    Get all reviews received by the logged-in volunteer (with full elder & visit details)
// @route   GET /api/reviews/my-reviews
// @access  Private (Volunteer)
const getMyReviews = async (req, res) => {
  req.params.userId = req.user._id.toString();
  return getUserReviews(req, res);
};

module.exports = {
  getUserReviews,
  getMyReviews,
  createReview,
};
