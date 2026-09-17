// routes/volunteerOfferRoutes.js
const express = require('express');
const router = express.Router();
const {
  createOffer,
  getMyOffers,
  getAllOffers,
  updateOffer,
  deleteOffer,
  acceptOffer,
} = require('../controllers/volunteerOfferController');
const { protect } = require('../middleware/authMiddleware');

router.route('/')
  .post(protect, createOffer)
  .get(getAllOffers);

router.get('/my-offers', protect, getMyOffers);

router.post('/:id/accept', protect, acceptOffer);

router.route('/:id')
  .put(protect, updateOffer)
  .delete(protect, deleteOffer);

module.exports = router;
