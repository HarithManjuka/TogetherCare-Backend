// routes/adminUserRoutes.js
const express = require('express');
const router = express.Router();
const { protect, authorizeRoles } = require('../middleware/authMiddleware');
const {
  getAdminUsers,
  getAdminUserDetails,
  createAdminUser,
  updateAdminUserDetails,
  banUser,
  unbanUser,
} = require('../controllers/adminUserController');

// Protect all admin user routes
router.use(protect);
router.use(authorizeRoles('admin'));

router.route('/')
  .get(getAdminUsers)
  .post(createAdminUser);

router.route('/:id')
  .get(getAdminUserDetails)
  .put(updateAdminUserDetails);

router.post('/:id/ban', banUser);
router.post('/:id/unban', unbanUser);

module.exports = router;
