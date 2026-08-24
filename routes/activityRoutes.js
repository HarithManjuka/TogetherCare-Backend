// routes/activityRoutes.js
const express = require('express');
const router = express.Router();
const { getAllActivities, createActivity } = require('../controllers/activityController');
const { protect } = require('../middleware/authMiddleware');

router.get('/', getAllActivities);
router.post('/', protect, createActivity);

module.exports = router;
