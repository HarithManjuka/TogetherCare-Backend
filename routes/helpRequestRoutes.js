// routes/helpRequestRoutes.js
const express = require('express');
const router = express.Router();
const {
  createHelpRequest,
  getHelpRequests,
  getRequestDetails,
  approveMatch,
  rejectMatch,
  triggerSOS,
  submitFeedback,
  simulateStatus,
} = require('../controllers/helpRequestController');
const { protect } = require('../middleware/authMiddleware');

router.use(protect);

router.route('/')
  .post(createHelpRequest)
  .get(getHelpRequests);

router.route('/:id')
  .get(getRequestDetails);

router.post('/:id/approve', approveMatch);
router.post('/:id/reject', rejectMatch);
router.post('/:id/sos', triggerSOS);
router.post('/:id/feedback', submitFeedback);
router.post('/:id/simulate-status', simulateStatus);

module.exports = router;
