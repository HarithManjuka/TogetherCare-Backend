// routes/volunteerOfferRoutes.js
const express = require('express');
const router = express.Router();
const {
  createOffer,
  getMyOffers,
  getAllOffers,
  updateOffer,
  deleteOffer,
  getAvailableRequests,
  acceptRequest,
  getMySchedule,
  updateTaskStatus,
  getMyHistory,
  getMyStats,
  getDirectRequests,
} = require('../controllers/volunteerOfferController');
const { protect } = require('../middleware/authMiddleware');

// Community offers
router.route('/')
  .post(protect, createOffer)
  .get(getAllOffers);

router.get('/my-offers', protect, getMyOffers);

// Volunteer tasks & requests
router.get('/direct-requests', protect, getDirectRequests);
router.get('/available-requests', protect, getAvailableRequests);
router.post('/requests/:id/accept', protect, acceptRequest);
router.get('/my-schedule', protect, getMySchedule);
router.put('/tasks/:id/status', protect, updateTaskStatus);
router.get('/my-history', protect, getMyHistory);
router.get('/my-stats', protect, getMyStats);

// Offer operations by ID
router.route('/:id')
  .put(protect, updateOffer)
  .delete(protect, deleteOffer);

module.exports = router;

