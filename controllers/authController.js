// controllers/authController.js
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { generateHumanReadableId } = require('../utils/customIdGenerator');

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

module.exports = { registerUser, loginUser, getMe };