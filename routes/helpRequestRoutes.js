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
  getAvailableAssignments,
  acceptCaregiverAssignment,
  getCompletedCaregiverVisits,
} = require('../controllers/helpRequestController');
const { protect } = require('../middleware/authMiddleware');

router.use(protect);

// Caregiver Assignment & Visit tracking routes (Sprint 3 & US-402)
router.get('/caregiver/assignments', getAvailableAssignments);
router.post('/caregiver/assignments/:id/accept', acceptCaregiverAssignment);
router.get('/caregiver/visits/completed', getCompletedCaregiverVisits);

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
