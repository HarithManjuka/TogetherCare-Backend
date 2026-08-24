// routes/companionshipRoutes.js
const express = require('express');
const router = express.Router();
const {
  getUpcomingVisits,
  getMyRequests,
  getOpenRequests,
  createRequest,
  cancelRequest,
  updateRequest,
  deleteRequest,
} = require('../controllers/companionshipController');
const { protect } = require('../middleware/authMiddleware');

// All companionship routes require authentication
router.use(protect);

router.get('/upcoming', getUpcomingVisits);
router.get('/my-requests', getMyRequests);
router.get('/open-requests', getOpenRequests);
router.post('/create', createRequest);
router.put('/:id', updateRequest);
router.put('/:id/cancel', cancelRequest);
router.delete('/:id', deleteRequest);

module.exports = router;



