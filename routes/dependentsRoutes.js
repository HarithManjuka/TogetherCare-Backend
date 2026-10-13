const express = require('express');
const router = express.Router();
const {
  getDependents,
  addDependent,
  getUnlinkedElderly,
  linkDependent,
  requestLink,
  respondLink,
  getPendingRequests,
  unlinkDependent,
  getDependentActivities,
  getUpcomingCareVisits,
} = require('../controllers/dependentsController');
const { protect, authorize } = require('../middleware/authMiddleware');

router.use(protect);

// Routes accessible by both Elderly and Caregiver (and Admin)
router.get('/pending-requests', authorize('elderly', 'caregiver', 'admin'), getPendingRequests);
router.post('/respond-link', authorize('elderly', 'caregiver', 'admin'), respondLink);
router.post('/unlink', authorize('elderly', 'caregiver', 'admin'), unlinkDependent);

// Routes for Caregiver / Admin oversight
router.get('/unlinked', authorize('caregiver', 'admin'), getUnlinkedElderly);
router.post('/link', authorize('caregiver', 'admin'), requestLink);
router.post('/request-link', authorize('caregiver', 'admin'), requestLink);
router.get('/upcoming-visits', authorize('caregiver', 'admin'), getUpcomingCareVisits);
router.get('/:id/activities', authorize('caregiver', 'admin'), getDependentActivities);

router.route('/')
  .get(authorize('caregiver', 'admin'), getDependents)
  .post(authorize('caregiver', 'admin'), addDependent);

module.exports = router;
