// controllers/authController.js
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const crypto = require('crypto');
const { generateHumanReadableId } = require('../utils/customIdGenerator');
const { sendPasswordResetOtpEmail } = require('../utils/emailService');

const generateToken = (id, role, customId) => {
  return jwt.sign({ id, role, customId }, process.env.JWT_SECRET, {
    expiresIn: '30d',
  });
};

const calculateAge = (dob) => {
  const diff = Date.now() - new Date(dob).getTime();
  const ageDate = new Date(diff);
  return Math.abs(ageDate.getUTCFullYear() - 1970);
};

// @desc    Register a new user with generated customId
// @route   POST /api/auth/register
// @access  Public
const registerUser = async (req, res) => {
  try {
    const {
      firstName,
      lastName,
      email,
      password,
      phone,
      role,
      caregiverType,
      dateOfBirth,
      address,
      emergencyContact,
      linkedCaregiverId,
      volunteerIdType,
      volunteerIdNumber,
      educationalInstitution,
      relationshipToElderly,
      organizationName,
    } = req.body;

    if (!firstName || !lastName || !email || !password || !phone || !role || !dateOfBirth || !address) {
      return res.status(400).json({
        success: false,
        message: 'Please fill in all mandatory registration fields',
      });
    }

    const age = calculateAge(dateOfBirth);
    if (age < 10 || age > 150) {
      return res.status(400).json({
        success: false,
        message: 'Age must be between 10 and 150 years',
      });
    }

    if (role === 'elderly' && age < 40) {
      return res.status(400).json({
        success: false,
        message: 'Elderly users must be at least 40 years old',
      });
    }

    const userExists = await User.findOne({ email: email.toLowerCase() });
    if (userExists) {
      return res.status(409).json({
        success: false,
        message: 'An account with this email already exists',
      });
    }

    // 1. Generate the unique 8-character human-friendly user ID
    const customId = await generateHumanReadableId(role);

    // 2. Create User record with customId
    const user = await User.create({
      customId,
      firstName,
      lastName,
      email: email.toLowerCase(),
      password,
      phone,
      role,
      caregiverType: role === 'caregiver' ? caregiverType : null,
      dateOfBirth,
      age,
      address,
      accountStatus: 'pending_verification',
      emergencyContact: role === 'elderly' ? emergencyContact : undefined,
      linkedCaregiverId: role === 'elderly' && linkedCaregiverId ? linkedCaregiverId : null,
      volunteerIdType: role === 'volunteer' ? volunteerIdType : null,
      volunteerIdNumber: role === 'volunteer' ? volunteerIdNumber : '',
      educationalInstitution: role === 'volunteer' && volunteerIdType === 'Student ID' ? educationalInstitution : '',
      verificationBadgeStatus: 'unverified',
      relationshipToElderly: role === 'caregiver' ? relationshipToElderly : '',
      organizationName: role === 'caregiver' ? organizationName : '',
    });

    const token = generateToken(user._id, user.role, user.customId);

    return res.status(201).json({
      success: true,
      message: 'Registration submitted successfully',
      token,
      user: {
        _id: user._id,
        customId: user.customId,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        phone: user.phone,
        role: user.role,
        caregiverType: user.caregiverType,
        age: user.age,
        accountStatus: user.accountStatus,
        verificationBadgeStatus: user.verificationBadgeStatus,
      },
    });
  } catch (error) {
    console.error('Registration Error:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Server error during registration',
    });
  }
};

// @desc    Authenticate user & return customId
// @route   POST /api/auth/login
// @access  Public
const loginUser = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Please provide both email and password',
      });
    }

    const user = await User.findOne({ email: email.toLowerCase() }).select('+password');

    if (!user || !(await user.matchPassword(password))) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password',
      });
    }

    const token = generateToken(user._id, user.role, user.customId);

    return res.status(200).json({
      success: true,
      message: 'Login successful',
      token,
      user: {
        _id: user._id,
        customId: user.customId,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        phone: user.phone,
        role: user.role,
        caregiverType: user.caregiverType,
        accountStatus: user.accountStatus,
        verificationBadgeStatus: user.verificationBadgeStatus,
      },
    });
  } catch (error) {
    console.error('Login Error:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error during login',
    });
  }
};

const getMe = async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    return res.status(200).json({ success: true, user });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Server error fetching user profile' });
  }
};

// @desc    Request Password Reset OTP
// @route   POST /api/auth/forgot-password
// @access  Public
const forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ success: false, message: 'Please provide your email address' });
    }

    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) {
      // Return success to avoid email enumeration attacks
      return res.status(200).json({
        success: true,
        message: 'If an account with this email exists, a verification code has been dispatched.',
      });
    }

    // Generate cryptographically secure 4-digit code (1000 - 9999)
    const otp = Math.floor(1000 + Math.random() * 9000).toString();

    // Hash OTP before storing in DB
    user.resetPasswordOtpHash = crypto.createHash('sha256').update(otp).digest('hex');
    user.resetPasswordOtpExpires = Date.now() + 10 * 60 * 1000; // 10 minutes
    user.passwordResetSessionToken = undefined;
    await user.save();

    // Send branded email with development fallback if SMTP credentials fail
    try {
      await sendPasswordResetOtpEmail(user.email, user.firstName, otp);
      return res.status(200).json({
        success: true,
        message: 'Verification code sent to your email',
      });
    } catch (emailError) {
      console.error('Forgot Password Email Dispatch Error:', emailError.message || emailError);

      // Development / testing fallback: if SMTP authentication fails or credentials expire, log OTP to server console
      if (process.env.NODE_ENV !== 'production') {
        console.log(`\n======================================================`);
        console.log(`🔑 [DEV MODE OTP FALLBACK]`);
        console.log(`Target Email : ${user.email}`);
        console.log(`Reset OTP    : ${otp}`);
        console.log(`Note         : SMTP delivery failed (${emailError.code || 'EAUTH'}). OTP logged here for local testing.`);
        console.log(`======================================================\n`);

        return res.status(200).json({
          success: true,
          message: 'Verification code generated (Check server console in development mode).',
        });
      }

      return res.status(500).json({ success: false, message: 'Failed to send verification email' });
    }
  } catch (error) {
    console.error('Forgot Password Error:', error);
    return res.status(500).json({ success: false, message: 'Server error processing password reset request' });
  }
};

// @desc    Verify 4-Digit Reset OTP
// @route   POST /api/auth/verify-reset-otp
// @access  Public
const verifyResetOtp = async (req, res) => {
  try {
    const { email, otp } = req.body;
    if (!email || !otp) {
      return res.status(400).json({ success: false, message: 'Email and 4-digit code are required' });
    }

    const hashedOtp = crypto.createHash('sha256').update(otp.toString().trim()).digest('hex');

    const user = await User.findOne({
      email: email.toLowerCase(),
      resetPasswordOtpHash: hashedOtp,
      resetPasswordOtpExpires: { $gt: Date.now() },
    }).select('+resetPasswordOtpHash +resetPasswordOtpExpires');

    if (!user) {
      return res.status(400).json({ success: false, message: 'Invalid or expired verification code' });
    }

    // Issue a 15-minute authorized reset session token
    const sessionToken = crypto.randomBytes(32).toString('hex');
    user.passwordResetSessionToken = sessionToken;
    user.resetPasswordOtpHash = undefined;
    user.resetPasswordOtpExpires = undefined;
    await user.save();

    return res.status(200).json({
      success: true,
      message: 'Code verified successfully',
      sessionToken,
    });
  } catch (error) {
    console.error('Verify OTP Error:', error);
    return res.status(500).json({ success: false, message: 'Error verifying code' });
  }
};

// @desc    Update Password with Valid Session Token
// @route   POST /api/auth/reset-password
// @access  Public
const resetPassword = async (req, res) => {
  try {
    const { email, sessionToken, newPassword } = req.body;

    if (!email || !sessionToken || !newPassword) {
      return res.status(400).json({ success: false, message: 'All fields are required' });
    }

    if (newPassword.length < 4) {
      return res.status(400).json({ success: false, message: 'Password must be at least 4 characters' });
    }

    const user = await User.findOne({
      email: email.toLowerCase(),
      passwordResetSessionToken: sessionToken,
    }).select('+passwordResetSessionToken');

    if (!user) {
      return res.status(400).json({ success: false, message: 'Invalid or expired reset session. Please request a new code.' });
    }

    // Set new password (pre-save hook hashes it automatically)
    user.password = newPassword;
    user.passwordResetSessionToken = undefined;
    await user.save();

    return res.status(200).json({
      success: true,
      message: 'Password updated successfully',
    });
  } catch (error) {
    console.error('Reset Password Error:', error);
    return res.status(500).json({ success: false, message: 'Failed to reset password' });
  }
};

module.exports = {
  registerUser,
  loginUser,
  getMe,
  forgotPassword,
  verifyResetOtp,
  resetPassword,
};
