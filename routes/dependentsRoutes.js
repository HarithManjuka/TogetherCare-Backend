// routes/dependentsRoutes.js
const express = require('express');
const router = express.Router();
const {
  getDependents,
  addDependent,
  getUnlinkedElderly,
  linkDependent,
} = require('../controllers/dependentsController');
const { protect, authorize } = require('../middleware/authMiddleware');

router.use(protect);
router.use(authorize('caregiver', 'admin'));

router.get('/unlinked', getUnlinkedElderly);
router.post('/link', linkDependent);

router.route('/')
  .get(getDependents)
  .post(addDependent);

module.exports = router;
