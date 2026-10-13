// routes/emergencyRoutes.js
const express = require('express');
const router = express.Router();
const {
  triggerSOS,
  getActiveSOS,
  resolveSOS,
  getEmergencyHistory,
  getCareCircle,
  addCareCircleContact,
  updateCareCircleContact,
  deleteCareCircleContact,
  setPrimaryCareCircleContact,
} = require('../controllers/emergencyController');
const { protect } = require('../middleware/authMiddleware');

router.use(protect);

// SOS Alerts
router.post('/sos', triggerSOS);
router.get('/active', getActiveSOS);
router.post('/resolve', resolveSOS);
router.post('/:id/resolve', resolveSOS);
router.get('/history', getEmergencyHistory);

// Care Circle (Emergency Contacts)
router.get('/care-circle', getCareCircle);
router.post('/care-circle', addCareCircleContact);
router.put('/care-circle/:id', updateCareCircleContact);
router.delete('/care-circle/:id', deleteCareCircleContact);
router.patch('/care-circle/:id/primary', setPrimaryCareCircleContact);

module.exports = router;
