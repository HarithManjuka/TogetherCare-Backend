// routes/reviewRoutes.js
const express = require('express');
const router = express.Router();
const { getUserReviews, getMyReviews, createReview } = require('../controllers/reviewController');
const { protect } = require('../middleware/authMiddleware');

router.get('/my-reviews', protect, getMyReviews);
router.get('/user/:userId', getUserReviews);
router.post('/', protect, createReview);

module.exports = router;
