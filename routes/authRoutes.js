// routes/authRoutes.js
const express = require('express');
const router = express.Router();
const {
  registerUser,
  loginUser,
  getMe,
  uploadProfilePicture,
  deleteProfilePicture,
  updateUserProfile,
} = require('../controllers/authController');
const { protect } = require('../middleware/authMiddleware');
const { handleUpload } = require('../middleware/uploadMiddleware');

// Public auth routes
router.post('/register', registerUser);
router.post('/login', loginUser);

// Protected user profile routes
router.get('/me', protect, getMe);
router.put('/profile', protect, updateUserProfile);

// Profile picture upload / update / delete routes (Accepts multipart or base64 JSON)
router.put(
  '/profile-picture',
  protect,
  handleUpload,
  uploadProfilePicture
);
router.post(
  '/profile-picture',
  protect,
  handleUpload,
  uploadProfilePicture
);
router.delete(
  '/profile-picture',
  protect,
  deleteProfilePicture
);

module.exports = router;