// controllers/authController.js
const jwt = require('jsonwebtoken');
const User = require('../models/User');

const generateToken = (id, role) => {
  return jwt.sign({ id, role }, process.env.JWT_SECRET, {
    expiresIn: '30d',
  });
};

// Calculate age helper
const calculateAge = (dob) => {
  const diff = Date.now() - new Date(dob).getTime();
  const ageDate = new Date(diff);
  return Math.abs(ageDate.getUTCFullYear() - 1970);
};

// @desc    Register a new user with full role validation
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

    // 1. Basic Common Validations
    const missingBasic = [];
    if (!firstName) missingBasic.push('First Name');
    if (!lastName) missingBasic.push('Last Name');
    if (!email) missingBasic.push('Email');
    if (!password) missingBasic.push('Password');
    if (!phone) missingBasic.push('Phone');
    if (!role) missingBasic.push('Role');
    if (!dateOfBirth) missingBasic.push('Date of Birth');
    if (!address) missingBasic.push('Address');

    if (missingBasic.length > 0) {
      return res.status(400).json({
        success: false,
        message: `Please fill in all mandatory registration fields: ${missingBasic.join(', ')}`,
        missingFields: missingBasic,
      });
    }

    const missingAddress = [];
    if (!address.streetAddress) missingAddress.push('Street Address');
    if (!address.city) missingAddress.push('City');
    if (!address.postalCode) missingAddress.push('Postal Code');
    if (!address.district) missingAddress.push('District');
    if (!address.province) missingAddress.push('Province');

    if (missingAddress.length > 0) {
      return res.status(400).json({
        success: false,
        message: `Please complete all address fields: ${missingAddress.join(', ')}`,
        missingFields: missingAddress,
      });
    }

    // 2. Age Validation
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
        message: 'Users registering as Elderly must be at least 40 years old',
      });
    }

    // 3. Check for Existing Email
    const userExists = await User.findOne({ email: email.toLowerCase() });
    if (userExists) {
      return res.status(409).json({
        success: false,
        message: 'An account with this email already exists',
      });
    }

    // 4. Role-Specific Validations
    if (role === 'volunteer') {
      if (!volunteerIdType || !volunteerIdNumber) {
        return res.status(400).json({
          success: false,
          message: 'Volunteers must select an ID type (NIC/Student ID/Passport) and provide the ID number',
        });
      }
      if (volunteerIdType === 'Student ID' && !educationalInstitution) {
        return res.status(400).json({
          success: false,
          message: 'Please mention your educational institution when using Student ID',
        });
      }
    }

    if (role === 'caregiver' && !caregiverType) {
      return res.status(400).json({
        success: false,
        message: 'Please specify whether you are a formal caregiver or family member',
      });
    }

    // 5. Create Record
    const user = await User.create({
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

      // Elderly fields
      emergencyContact: role === 'elderly' ? emergencyContact : undefined,
      linkedCaregiverId: role === 'elderly' && linkedCaregiverId ? linkedCaregiverId : null,

      // Volunteer fields
      volunteerIdType: role === 'volunteer' ? volunteerIdType : null,
      volunteerIdNumber: role === 'volunteer' ? volunteerIdNumber : '',
      educationalInstitution: role === 'volunteer' && volunteerIdType === 'Student ID' ? educationalInstitution : '',
      verificationBadgeStatus: 'unverified',

      // Caregiver fields
      relationshipToElderly: role === 'caregiver' ? relationshipToElderly : '',
      organizationName: role === 'caregiver' ? organizationName : '',
    });

    const token = generateToken(user._id, user.role);

    return res.status(201).json({
      success: true,
      message: 'Registration submitted successfully (pending verification)',
      token,
      user: {
        _id: user._id,
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

// @desc    Authenticate user & get token
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

    const token = generateToken(user._id, user.role);

    return res.status(200).json({
      success: true,
      message: 'Login successful',
      token,
      user: {
        _id: user._id,
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

// @desc    Get current user profile
// @route   GET /api/auth/me
// @access  Private
const getMe = async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    return res.status(200).json({ success: true, user });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Server error fetching user profile' });
  }
};

module.exports = { registerUser, loginUser, getMe };