// controllers/authController.js
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Review = require('../models/Review');
const { generateHumanReadableId, fixDuplicateUserIds } = require('../utils/customIdGenerator');
const { sendPasswordResetOtpEmail, sendAccountEmailVerificationOtp } = require('../utils/emailService');
const {
  uploadUserProfilePicture,
  deleteUserProfilePicture,
} = require('../services/cloudinaryService');

const generateToken = (id, role, customId) => {
  return jwt.sign({ id, role, customId }, process.env.JWT_SECRET, {
    expiresIn: '30d',
  });
};

// Calculate age helper
const calculateAge = (dob) => {
  if (!dob) return null;
  const today = new Date();
  const birthDate = new Date(dob);
  let age = today.getFullYear() - birthDate.getFullYear();
  const monthDiff = today.getMonth() - birthDate.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
    age--;
  }
  return Math.max(0, age);
};

// Helper: Sanitize user object for API responses
const sanitizeUser = (user) => {
  const userObj = typeof user.toObject === 'function' ? user.toObject({ virtuals: true }) : { ...user };
  if (userObj.dateOfBirth) {
    userObj.age = calculateAge(userObj.dateOfBirth);
  }
  if (!userObj.customId || userObj.customId.includes('{prefix}') || userObj.customId.includes('({prefix}')) {
    const rolePrefixMap = {
      elderly: 'ELD',
      volunteer: 'VOL',
      caregiver: 'CG',
      admin: 'ADM',
    };
    const prefix = rolePrefixMap[userObj.role] || 'USR';
    const shortId = String(userObj._id || '').slice(-4).toUpperCase() || '0001';
    userObj.customId = `${prefix}-${shortId}`;
  }
  delete userObj.password;
  delete userObj.resetPasswordOtpHash;
  delete userObj.resetPasswordOtpExpires;
  delete userObj.passwordResetSessionToken;
  delete userObj.emailVerificationOtpHash;
  delete userObj.emailVerificationOtpExpires;
  return userObj;
};

// @desc    Register a new user with full role validation and atomic ID generation
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
      gender,
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

    // Atomic Sequential ID Generation
    const customId = await generateHumanReadableId(role);

    const validGenders = ['male', 'female', 'other', 'not_specified'];
    const userGender = gender && validGenders.includes(String(gender).toLowerCase().trim())
      ? String(gender).toLowerCase().trim()
      : 'not_specified';

    // 5. Create Record
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
      gender: userGender,
      age,
      address,
      accountStatus: 'pending_verification',
      profilePicture: '',
      profilePicturePublicId: '',

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

    const token = generateToken(user._id, user.role, user.customId);

    return res.status(201).json({
      success: true,
      message: 'Registration submitted successfully (pending verification)',
      token,
      user: sanitizeUser(user),
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

    const token = generateToken(user._id, user.role, user.customId);

    return res.status(200).json({
      success: true,
      message: 'Login successful',
      token,
      user: sanitizeUser(user),
    });
  } catch (error) {
    console.error('Login Error:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error during login',
    });
  }
};

// @desc    Get current user profile (with reviews & rating stats from database)
// @route   GET /api/auth/me
// @access  Private
const getMe = async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    if (!user.customId || user.customId.includes('{prefix}') || user.customId.includes('({prefix}')) {
      const { generateHumanReadableId } = require('../utils/customIdGenerator');
      user.customId = await generateHumanReadableId(user.role || 'elderly');
      await user.save();
    }

    const userObj = sanitizeUser(user);

    const reviews = await Review.find({ recipient: req.user._id });
    const totalReviews = reviews.length;
    let averageRating = 0;

    if (totalReviews > 0) {
      const sum = reviews.reduce((acc, curr) => acc + curr.rating, 0);
      averageRating = Number((sum / totalReviews).toFixed(1));
    }

    userObj.averageRating = averageRating;
    userObj.totalReviews = totalReviews;

    return res.status(200).json({ success: true, user: userObj });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Server error fetching user profile' });
  }
};

// @desc    Upload or update user profile picture (Cloudinary)
// @route   PUT /api/auth/profile-picture
// @access  Private
const uploadProfilePicture = async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    let uploadResult;

    if (req.file && req.file.buffer) {
      uploadResult = await uploadUserProfilePicture({ buffer: req.file.buffer });
    } else if (req.body && (req.body.imageBase64 || req.body.image || req.body.profilePicture)) {
      const base64Data = req.body.imageBase64 || req.body.image || req.body.profilePicture;
      uploadResult = await uploadUserProfilePicture({ base64Data });
    } else {
      return res.status(400).json({
        success: false,
        message: 'Please provide an image file or base64 data URI',
      });
    }

    if (user.profilePicturePublicId && user.profilePicturePublicId !== uploadResult.public_id) {
      await deleteUserProfilePicture(user.profilePicturePublicId);
    }

    const updatedUser = await User.findByIdAndUpdate(
      req.user._id,
      {
        $set: {
          profilePicture: uploadResult.secure_url,
          profilePicturePublicId: uploadResult.public_id,
        },
      },
      { new: true }
    );

    return res.status(200).json({
      success: true,
      message: 'Profile picture uploaded successfully',
      profilePicture: updatedUser.profilePicture,
      user: sanitizeUser(updatedUser),
    });
  } catch (error) {
    console.error('Profile Picture Upload Error:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error uploading profile picture',
      error: error.message,
    });
  }
};

// @desc    Delete user profile picture (Cloudinary & Database)
// @route   DELETE /api/auth/profile-picture
// @access  Private
const deleteProfilePicture = async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    if (user.profilePicturePublicId) {
      await deleteUserProfilePicture(user.profilePicturePublicId);
    }

    const updatedUser = await User.findByIdAndUpdate(
      req.user._id,
      {
        $set: {
          profilePicture: '',
          profilePicturePublicId: '',
        },
      },
      { new: true }
    );

    return res.status(200).json({
      success: true,
      message: 'Profile picture deleted successfully',
      profilePicture: '',
      user: sanitizeUser(updatedUser),
    });
  } catch (error) {
    console.error('Profile Picture Deletion Error:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error deleting profile picture',
      error: error.message,
    });
  }
};

const RESTRICTED_PROFILE_FIELDS = [
  'role',
  'customId',
  'accountStatus',
  'verificationBadgeStatus',
  'isEmailVerified',
  'password',
  '_id',
  'resetPasswordOtpHash',
  'resetPasswordOtpExpires',
  'passwordResetSessionToken',
  'emailVerificationOtpHash',
  'emailVerificationOtpExpires',
];

// @desc    Update user profile - Strict whitelist of editable fields
// @route   PUT /api/auth/profile
// @access  Private
const updateUserProfile = async (req, res) => {
  try {
    const attemptedRestricted = Object.keys(req.body || {}).filter((key) =>
      RESTRICTED_PROFILE_FIELDS.includes(key)
    );

    if (attemptedRestricted.length > 0) {
      return res.status(400).json({
        success: false,
        message: `Security exception: You are not authorized to modify restricted field(s): ${attemptedRestricted.join(
          ', '
        )}`,
      });
    }

    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    const {
      firstName,
      lastName,
      phone,
      dateOfBirth,
      gender,
      age,
      address,
      interests,
      profilePicture,
      emergencyContact,
      relationshipToElderly,
      organizationName,
      volunteerIdType,
      volunteerIdNumber,
      educationalInstitution,
    } = req.body;

    if (firstName !== undefined) {
      if (!firstName.trim() || !/^[A-Za-z]+$/.test(firstName.trim())) {
        return res.status(400).json({
          success: false,
          message: 'First name can only contain letters (no numbers or symbols)',
        });
      }
      user.firstName = firstName.trim();
    }

    if (lastName !== undefined) {
      if (!lastName.trim() || !/^[A-Za-z]+$/.test(lastName.trim())) {
        return res.status(400).json({
          success: false,
          message: 'Last name can only contain letters (no numbers or symbols)',
        });
      }
      user.lastName = lastName.trim();
    }

    if (phone !== undefined) {
      const phoneRegex = /^(?:0|94|\+94)?(7[0-9]{8})$/;
      if (!phoneRegex.test(phone.trim())) {
        return res.status(400).json({
          success: false,
          message: 'Please provide a valid Sri Lankan mobile number (e.g. 07XXXXXXXX or +947XXXXXXXX)',
        });
      }
      user.phone = phone.trim();
    }

    if (dateOfBirth !== undefined) {
      const dobDate = new Date(dateOfBirth);
      if (isNaN(dobDate.getTime())) {
        return res.status(400).json({
          success: false,
          message: 'Please provide a valid date of birth',
        });
      }
      user.dateOfBirth = dobDate;
    }

    if (gender !== undefined) {
      const validGenders = ['male', 'female', 'other', 'not_specified'];
      const normalizedGender = String(gender).toLowerCase().trim();
      if (!validGenders.includes(normalizedGender)) {
        return res.status(400).json({
          success: false,
          message: 'Gender must be male, female, other, or not_specified',
        });
      }
      user.gender = normalizedGender;
    }

    if (age !== undefined) {
      const numAge = Number(age);
      if (isNaN(numAge) || numAge < 10 || numAge > 150) {
        return res.status(400).json({
          success: false,
          message: 'Age must be a valid number between 10 and 150',
        });
      }
      user.age = numAge;
    }

    if (address !== undefined) {
      if (typeof address === 'string' && address.trim()) {
        user.address = {
          streetAddress: user.address?.streetAddress || address.trim(),
          city: address.trim(),
          postalCode: user.address?.postalCode || '20000',
          district: user.address?.district || 'Kandy',
          province: user.address?.province || 'Central',
        };
      } else if (typeof address === 'object') {
        user.address = {
          ...(user.address || {}),
          ...address,
        };
      }
    }

    if (profilePicture === '') {
      if (user.profilePicturePublicId) {
        await deleteUserProfilePicture(user.profilePicturePublicId);
      }
      user.profilePicture = '';
      user.profilePicturePublicId = '';
    }

    if (interests !== undefined && Array.isArray(interests)) {
      user.interests = interests;
    }

    if (emergencyContact !== undefined && typeof emergencyContact === 'object') {
      user.emergencyContact = {
        ...(user.emergencyContact || {}),
        ...emergencyContact,
      };
    }

    if (relationshipToElderly !== undefined) {
      user.relationshipToElderly = String(relationshipToElderly).trim();
    }
    if (organizationName !== undefined) {
      user.organizationName = String(organizationName).trim();
    }

    if (volunteerIdType !== undefined) {
      user.volunteerIdType = volunteerIdType;
    }
    if (volunteerIdNumber !== undefined) {
      user.volunteerIdNumber = String(volunteerIdNumber).trim();
    }
    if (educationalInstitution !== undefined) {
      user.educationalInstitution = String(educationalInstitution).trim();
    }

    await user.save();

    return res.status(200).json({
      success: true,
      message: 'Profile updated successfully',
      user: sanitizeUser(user),
    });
  } catch (error) {
    console.error('Update Profile Error:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error updating profile',
      error: error.message,
    });
  }
};

// @desc    Request Password Reset OTP
// @route   POST /api/auth/forgot-password
// @access  Public
const forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;
    if (typeof email !== 'string' || !email.trim()) {
      return res.status(400).json({ success: false, message: 'Please provide your email address' });
    }
    const normalizedEmail = email.trim().toLowerCase();

    const user = await User.findOne({ email: normalizedEmail });
    if (!user) {
      return res.status(200).json({
        success: true,
        message: 'If an account with this email exists, a verification code has been dispatched.',
      });
    }

    const otp = Math.floor(1000 + Math.random() * 9000).toString();
    user.resetPasswordOtpHash = crypto.createHash('sha256').update(otp).digest('hex');
    user.resetPasswordOtpExpires = Date.now() + 10 * 60 * 1000;
    user.passwordResetSessionToken = undefined;
    await user.save();

    try {
      await sendPasswordResetOtpEmail(user.email, user.firstName, otp);
      return res.status(200).json({
        success: true,
        message: 'Verification code sent to your email',
      });
    } catch (emailError) {
      console.error('Forgot Password Email Dispatch Error:', emailError.message || emailError);
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
    if (typeof email !== 'string' || typeof otp !== 'string' || !email.trim() || !otp.trim()) {
      return res.status(400).json({ success: false, message: 'Email and 4-digit code are required' });
    }
    const normalizedEmail = email.trim().toLowerCase();
    const normalizedOtp = otp.trim();

    const hashedOtp = crypto.createHash('sha256').update(normalizedOtp).digest('hex');

    const user = await User.findOne({
      email: normalizedEmail,
      resetPasswordOtpHash: hashedOtp,
      resetPasswordOtpExpires: { $gt: Date.now() },
    }).select('+resetPasswordOtpHash +resetPasswordOtpExpires');

    if (!user) {
      return res.status(400).json({ success: false, message: 'Invalid or expired verification code' });
    }

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

    if (
      typeof email !== 'string' ||
      typeof sessionToken !== 'string' ||
      typeof newPassword !== 'string' ||
      !email.trim() ||
      !sessionToken.trim() ||
      !newPassword
    ) {
      return res.status(400).json({ success: false, message: 'All fields are required' });
    }
    const normalizedEmail = email.trim().toLowerCase();
    const normalizedSessionToken = sessionToken.trim();

    if (newPassword.length < 4) {
      return res.status(400).json({ success: false, message: 'Password must be at least 4 characters' });
    }

    const user = await User.findOne({
      email: normalizedEmail,
      passwordResetSessionToken: normalizedSessionToken,
    }).select('+passwordResetSessionToken');

    if (!user) {
      return res.status(400).json({ success: false, message: 'Invalid or expired reset session. Please request a new code.' });
    }

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

// @desc    Get all users with strict field projection to prevent sensitive data leaks
// @route   GET /api/auth/users
// @access  Private
const getAllUsers = async (req, res) => {
  try {
    await fixDuplicateUserIds();

    const users = await User.find()
      .select('firstName lastName customId email role phone gender address verificationBadgeStatus isEmailVerified accountStatus profilePicture caregiverType age dateOfBirth emergencyContact volunteerIdType volunteerIdNumber educationalInstitution relationshipToElderly organizationName')
      .lean();

    return res.status(200).json({
      success: true,
      count: users.length,
      users,
    });
  } catch (error) {
    console.error('Get All Users Error:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error fetching user list',
    });
  }
};

// @desc    Request In-Profile Email Verification Code
// @route   POST /api/auth/send-email-verification-otp
// @access  Private
const sendEmailVerificationOtp = async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    if (user.isEmailVerified) {
      return res.status(400).json({ success: false, message: 'Your email is already verified' });
    }

    const otp = Math.floor(1000 + Math.random() * 9000).toString();

    user.emailVerificationOtpHash = crypto.createHash('sha256').update(otp).digest('hex');
    user.emailVerificationOtpExpires = Date.now() + 10 * 60 * 1000;
    await user.save();

    await sendAccountEmailVerificationOtp(user.email, user.firstName, otp);

    return res.status(200).json({
      success: true,
      message: `Verification code sent to ${user.email}`,
    });
  } catch (error) {
    console.error('Send Email Verification OTP Error:', error);
    return res.status(500).json({ success: false, message: 'Failed to send verification code' });
  }
};

// @desc    Verify 4-Digit Email Code
// @route   POST /api/auth/verify-profile-email
// @access  Private
const verifyProfileEmail = async (req, res) => {
  try {
    const { otp } = req.body;
    if (!otp) {
      return res.status(400).json({ success: false, message: 'Please provide the 4-digit verification code' });
    }

    const hashedOtp = crypto.createHash('sha256').update(otp.toString().trim()).digest('hex');

    const user = await User.findOne({
      _id: req.user._id,
      emailVerificationOtpHash: hashedOtp,
      emailVerificationOtpExpires: { $gt: Date.now() },
    }).select('+emailVerificationOtpHash +emailVerificationOtpExpires');

    if (!user) {
      return res.status(400).json({ success: false, message: 'Invalid or expired verification code' });
    }

    user.isEmailVerified = true;
    user.accountStatus = 'active';
    user.emailVerificationOtpHash = undefined;
    user.emailVerificationOtpExpires = undefined;
    await user.save();

    return res.status(200).json({
      success: true,
      message: 'Email address successfully verified!',
      user: {
        _id: user._id,
        customId: user.customId,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        role: user.role,
        isEmailVerified: user.isEmailVerified,
        accountStatus: user.accountStatus,
        verificationBadgeStatus: user.verificationBadgeStatus,
      },
    });
  } catch (error) {
    console.error('Verify Profile Email Error:', error);
    return res.status(500).json({ success: false, message: 'Error verifying email address' });
  }
};

module.exports = {
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
};