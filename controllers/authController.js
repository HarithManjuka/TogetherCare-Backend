// controllers/authController.js
const { Readable } = require('stream');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Review = require('../models/Review');
const cloudinary = require('../config/cloudinary');
const crypto = require('crypto');
const { generateHumanReadableId } = require('../utils/customIdGenerator');
const { sendPasswordResetOtpEmail } = require('../utils/emailService');

const generateToken = (id, role, customId) => {
  return jwt.sign({ id, role, customId }, process.env.JWT_SECRET, {
    expiresIn: '30d',
  });
};

// Calculate age helper
const calculateAge = (dob) => {
  const diff = Date.now() - new Date(dob).getTime();
  const ageDate = new Date(diff);
  return Math.abs(ageDate.getUTCFullYear() - 1970);
};

// Helper: Stream buffer upload to Cloudinary
const uploadToCloudinary = (buffer, folder = 'togethercare/profile_pictures') => {
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder,
        resource_type: 'image',
        transformation: [
          { width: 500, height: 500, crop: 'fill', gravity: 'face' },
          { quality: 'auto', fetch_format: 'auto' },
        ],
      },
      (error, result) => {
        if (error) return reject(error);
        resolve(result);
      }
    );

    Readable.from(buffer).pipe(uploadStream);
  });
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

    const customId = await generateHumanReadableId(role);

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
        profilePicture: user.profilePicture || '',
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
        profilePicture: user.profilePicture || '',
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

// @desc    Get current user profile (with reviews & rating stats from database)
// @route   GET /api/auth/me
// @access  Private
const getMe = async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const userObj = user.toObject();

    // Query live reviews from MongoDB Review table
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

    // 1. If sent as multipart/form-data with req.file
    if (req.file && req.file.buffer) {
      uploadResult = await uploadToCloudinary(req.file.buffer);
    }
    // 2. If sent as base64 string (e.g. from expo-image-picker base64: true)
    else if (req.body && (req.body.imageBase64 || req.body.image || req.body.profilePicture)) {
      const base64Data = req.body.imageBase64 || req.body.image || req.body.profilePicture;
      uploadResult = await cloudinary.uploader.upload(base64Data, {
        folder: 'togethercare/profile_pictures',
        resource_type: 'image',
        transformation: [
          { width: 500, height: 500, crop: 'fill', gravity: 'face' },
          { quality: 'auto', fetch_format: 'auto' },
        ],
      });
    } else {
      return res.status(400).json({
        success: false,
        message: 'Please provide an image file or base64 data URI',
      });
    }

    // If an existing Cloudinary image exists, delete it first to avoid orphans
    if (user.profilePicturePublicId && user.profilePicturePublicId !== uploadResult.public_id) {
      try {
        await cloudinary.uploader.destroy(user.profilePicturePublicId);
      } catch (cloudErr) {
        console.warn('Cloudinary delete previous picture warning:', cloudErr.message);
      }
    }

    // Update MongoDB user record directly
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
      user: {
        _id: updatedUser._id,
        firstName: updatedUser.firstName,
        lastName: updatedUser.lastName,
        email: updatedUser.email,
        profilePicture: updatedUser.profilePicture,
        role: updatedUser.role,
      },
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

    // Delete image from Cloudinary if publicId is stored
    if (user.profilePicturePublicId) {
      try {
        await cloudinary.uploader.destroy(user.profilePicturePublicId);
      } catch (cloudErr) {
        console.warn('Cloudinary destroy warning:', cloudErr.message);
      }
    }

    // Explicitly update MongoDB fields to empty string
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
      user: updatedUser,
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

// @desc    Update user profile (Name, Phone, Interests) - Email & Status are locked
// @route   PUT /api/auth/profile
// @access  Private
const updateUserProfile = async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    const { firstName, lastName, phone, age, address, interests, profilePicture } = req.body;

    // Validate firstName if provided
    if (firstName !== undefined) {
      if (!firstName.trim() || !/^[A-Za-z]+$/.test(firstName.trim())) {
        return res.status(400).json({
          success: false,
          message: 'First name can only contain letters (no numbers or symbols)',
        });
      }
      user.firstName = firstName.trim();
    }

    // Validate lastName if provided
    if (lastName !== undefined) {
      if (!lastName.trim() || !/^[A-Za-z]+$/.test(lastName.trim())) {
        return res.status(400).json({
          success: false,
          message: 'Last name can only contain letters (no numbers or symbols)',
        });
      }
      user.lastName = lastName.trim();
    }

    // Validate phone if provided
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

    // Validate & update age if provided
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

    // Validate & update address if provided
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

    // Support resetting profile picture if explicitly passed as empty
    if (profilePicture === '') {
      if (user.profilePicturePublicId) {
        try {
          await cloudinary.uploader.destroy(user.profilePicturePublicId);
        } catch (cloudErr) {
          console.warn('Cloudinary destroy warning:', cloudErr.message);
        }
      }
      user.profilePicture = '';
      user.profilePicturePublicId = '';
    }

    // Update interests if provided
    if (interests !== undefined && Array.isArray(interests)) {
      user.interests = interests;
    }

    await user.save();

    return res.status(200).json({
      success: true,
      message: 'Profile updated successfully',
      user: {
        _id: user._id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        phone: user.phone,
        role: user.role,
        age: user.age,
        address: user.address,
        accountStatus: user.accountStatus,
        verificationBadgeStatus: user.verificationBadgeStatus,
        profilePicture: user.profilePicture || '',
        interests: user.interests || [],
      },
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

module.exports = {
  registerUser,
  loginUser,
  getMe,
  uploadProfilePicture,
  deleteProfilePicture,
  updateUserProfile,
  forgotPassword,
  verifyResetOtp,
  resetPassword,
};