// routes/reviewRoutes.js
const express = require('express');
const router = express.Router();
const { getUserReviews, createReview } = require('../controllers/reviewController');
const { protect } = require('../middleware/authMiddleware');

router.get('/user/:userId', getUserReviews);
router.post('/', protect, createReview);

module.exports = router;
