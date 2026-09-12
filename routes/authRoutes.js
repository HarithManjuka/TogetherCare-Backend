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
  sendEmailVerificationOtp,
  verifyProfileEmail,
  updateUserVerificationStatus,
  deleteUserAccount,
} = require('../controllers/authController');
const { protect, authorize } = require('../middleware/authMiddleware');
const { handleUpload } = require('../middleware/uploadMiddleware');

// Public auth routes
router.post('/register', registerUser);
router.post('/login', loginUser);

// Protected user profile & list routes
router.get('/me', protect, getMe);
router.get('/users', protect, authorize('admin'), getAllUsers);
router.patch('/users/:id/verification', protect, authorize('admin'), updateUserVerificationStatus);
router.delete('/users/:id', protect, authorize('admin'), deleteUserAccount);
router.put('/profile', protect, updateUserProfile);

// Email Verification Flow
router.post('/send-email-verification-otp', protect, sendEmailVerificationOtp);
router.post('/verify-profile-email', protect, verifyProfileEmail);

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