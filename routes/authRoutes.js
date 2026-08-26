// routes/authRoutes.js
const express = require('express');
const router = express.Router();
const {
  registerUser,
  loginUser,
  getMe,
  getAllUsers,
  uploadProfilePicture,
  deleteProfilePicture,
  updateUserProfile,
  forgotPassword,
  verifyResetOtp,
  resetPassword,
} = require('../controllers/authController');
const { protect } = require('../middleware/authMiddleware');
const { handleUpload } = require('../middleware/uploadMiddleware');

// Public auth routes
router.post('/register', registerUser);
router.post('/login', loginUser);

// Protected user profile & list routes
router.get('/me', protect, getMe);
router.get('/users', protect, getAllUsers);
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

// Forgot Password Flow
router.post('/forgot-password', forgotPassword);
router.post('/verify-reset-otp', verifyResetOtp);
router.post('/reset-password', resetPassword);

module.exports = router;