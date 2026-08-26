// routes/volunteerOfferRoutes.js
const express = require('express');
const router = express.Router();
const {
  createOffer,
  getMyOffers,
  getAllOffers,
  updateOffer,
  deleteOffer,
} = require('../controllers/volunteerOfferController');
const { protect } = require('../middleware/authMiddleware');

router.route('/')
  .post(protect, createOffer)
  .get(getAllOffers);

router.get('/my-offers', protect, getMyOffers);

router.route('/:id')
  .put(protect, updateOffer)
  .delete(protect, deleteOffer);

module.exports = router;
