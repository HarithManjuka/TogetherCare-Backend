// routes/interestRoutes.js
const express = require('express');
const router = express.Router();
const { getAllInterests, createInterest } = require('../controllers/interestController');
const { protect } = require('../middleware/authMiddleware');

router.get('/', getAllInterests);
router.post('/', protect, createInterest);

module.exports = router;
