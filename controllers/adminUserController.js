// controllers/adminUserController.js
const User = require('../models/User');
const { generateHumanReadableId } = require('../utils/customIdGenerator');

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

// @desc    Get all users (with search and ban filters)
// @route   GET /api/admin/users
// @access  Private (Admin only)
const getAdminUsers = async (req, res) => {
  try {
    const { search, role, bannedOnly, myBannedOnly } = req.query;
    let query = {};

    if (role && role !== 'all') {
      query.role = role;
    }

    if (bannedOnly === 'true') {
      query.isBanned = true;
    }

    if (myBannedOnly === 'true') {
      query.isBanned = true;
      query.bannedBy = req.user._id;
    }

    if (search) {
      const regex = new RegExp(search.trim(), 'i');
      query.$or = [
        { firstName: regex },
        { lastName: regex },
        { email: regex },
        { customId: regex },
        { phone: regex },
      ];
    }

    const users = await User.find(query)
      .populate('bannedBy', 'firstName lastName email customId')
      .sort({ createdAt: -1 })
      .lean();

    return res.status(200).json({
      success: true,
      count: users.length,
      users,
    });
  } catch (error) {
    console.error('Admin Get Users Error:', error);
    return res.status(500).json({ success: false, message: 'Failed to retrieve users' });
  }
};

// @desc    Get single user full details
// @route   GET /api/admin/users/:id
// @access  Private (Admin only)
const getAdminUserDetails = async (req, res) => {
  try {
    const user = await User.findById(req.params.id)
      .populate('bannedBy', 'firstName lastName email customId')
      .populate('linkedCaregiverId', 'firstName lastName customId email phone')
      .lean();

    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    if (user.dateOfBirth) {
      user.age = calculateAge(user.dateOfBirth);
    }

    delete user.password;
    delete user.resetPasswordOtpHash;
    delete user.resetPasswordOtpExpires;
    delete user.emailVerificationOtpHash;

    return res.status(200).json({
      success: true,
      user,
    });
  } catch (error) {
    console.error('Admin Get User Details Error:', error);
    return res.status(500).json({ success: false, message: 'Failed to retrieve user details' });
  }
};

// @desc    Admin Create User (Any role)
// @route   POST /api/admin/users
// @access  Private (Admin only)
const createAdminUser = async (req, res) => {
  try {
    const {
      firstName,
      lastName,
      email,
      password,
      phone,
      role,
      dateOfBirth,
      gender,
      address,
      caregiverType,
      emergencyContact,
      volunteerIdType,
      volunteerIdNumber,
      educationalInstitution,
      relationshipToElderly,
      organizationName,
    } = req.body;

    // 1. Mandatory Fields Check
    const missingBasic = [];
    if (!firstName || !firstName.trim()) missingBasic.push('First Name');
    if (!lastName || !lastName.trim()) missingBasic.push('Last Name');
    if (!email || !email.trim()) missingBasic.push('Email');
    if (!password) missingBasic.push('Password');
    if (!phone || !phone.trim()) missingBasic.push('Phone');
    if (!role) missingBasic.push('Role');
    if (!dateOfBirth) missingBasic.push('Date of Birth');
    if (!address) missingBasic.push('Address');

    if (missingBasic.length > 0) {
      return res.status(400).json({
        success: false,
        message: `Mandatory field(s) missing: ${missingBasic.join(', ')}`,
      });
    }

    // Address fields check
    const missingAddress = [];
    if (!address.streetAddress || !address.streetAddress.trim()) missingAddress.push('Street Address');
    if (!address.city || !address.city.trim()) missingAddress.push('City');
    if (!address.postalCode || !address.postalCode.trim()) missingAddress.push('Postal Code');
    if (!address.district) missingAddress.push('District');
    if (!address.province) missingAddress.push('Province');

    if (missingAddress.length > 0) {
      return res.status(400).json({
        success: false,
        message: `Please complete all address fields: ${missingAddress.join(', ')}`,
      });
    }

    // 2. Format & Pattern Validation
    if (!/^[A-Za-z\s]+$/.test(firstName.trim())) {
      return res.status(400).json({ success: false, message: 'First name must contain only letters.' });
    }
    if (!/^[A-Za-z\s]+$/.test(lastName.trim())) {
      return res.status(400).json({ success: false, message: 'Last name must contain only letters.' });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim().toLowerCase())) {
      return res.status(400).json({ success: false, message: 'Please provide a valid email address.' });
    }
    if (password.length < 4) {
      return res.status(400).json({ success: false, message: 'Password must be at least 4 characters long.' });
    }
    if (!/^(?:0|94|\+94)?(7[0-9]{8})$/.test(phone.trim())) {
      return res.status(400).json({ success: false, message: 'Please provide a valid Sri Lankan mobile number (e.g. 0771234567).' });
    }
    if (!/^\d+$/.test(address.postalCode.trim())) {
      return res.status(400).json({ success: false, message: 'Postal code must contain numbers only.' });
    }

    // 3. Age Validation
    const age = calculateAge(dateOfBirth);
    if (age < 10 || age > 150) {
      return res.status(400).json({ success: false, message: 'Age must be between 10 and 150 years.' });
    }
    if (role === 'elderly' && age < 40) {
      return res.status(400).json({ success: false, message: 'Users with Elderly role must be at least 40 years old.' });
    }

    // 4. Role-Specific Validations
    if (role === 'volunteer') {
      if (!volunteerIdType || !volunteerIdNumber || !volunteerIdNumber.trim()) {
        return res.status(400).json({
          success: false,
          message: 'Volunteers must select an ID type (NIC/Student ID/Passport) and provide the ID number.',
        });
      }
      if (volunteerIdType === 'Student ID' && (!educationalInstitution || !educationalInstitution.trim())) {
        return res.status(400).json({
          success: false,
          message: 'Please mention educational institution when using Student ID.',
        });
      }
    }

    if (role === 'caregiver' && !caregiverType) {
      return res.status(400).json({
        success: false,
        message: 'Please specify whether the caregiver is a formal caregiver or family member.',
      });
    }

    // 5. Existing User Check
    const userExists = await User.findOne({ email: email.toLowerCase().trim() });
    if (userExists) {
      return res.status(409).json({ success: false, message: 'An account with this email already exists.' });
    }

    const customId = await generateHumanReadableId(role);
    const validGenders = ['male', 'female'];
    const userGender = gender && validGenders.includes(String(gender).toLowerCase().trim())
      ? String(gender).toLowerCase().trim()
      : 'male';

    const normalizedCaregiverType = caregiverType === 'family' || caregiverType === 'family_member'
      ? 'family_member'
      : caregiverType === 'formal' || caregiverType === 'formal_caregiver'
      ? 'formal_caregiver'
      : caregiverType || null;

    const newUser = await User.create({
      customId,
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      email: email.toLowerCase().trim(),
      password,
      phone: phone.trim(),
      role,
      dateOfBirth,
      age,
      gender: userGender,
      address: {
        streetAddress: address.streetAddress.trim(),
        city: address.city.trim(),
        postalCode: address.postalCode.trim(),
        district: address.district.trim(),
        province: address.province.trim(),
      },
      accountStatus: 'pending_verification',
      isEmailVerified: false,
      verificationBadgeStatus: 'unverified',
      caregiverType: role === 'caregiver' ? normalizedCaregiverType : null,
      emergencyContact: role === 'elderly' && emergencyContact ? {
        name: (emergencyContact.name || '').trim(),
        relation: (emergencyContact.relation || emergencyContact.relationship || '').trim(),
        phone: (emergencyContact.phone || '').trim(),
      } : undefined,
      volunteerIdType: role === 'volunteer' ? volunteerIdType : null,
      volunteerIdNumber: role === 'volunteer' ? volunteerIdNumber.trim() : '',
      educationalInstitution: role === 'volunteer' && volunteerIdType === 'Student ID' ? educationalInstitution.trim() : '',
      relationshipToElderly: role === 'caregiver' ? (relationshipToElderly || '').trim() : '',
      organizationName: role === 'caregiver' ? (organizationName || '').trim() : '',
    });

    const userResponse = newUser.toObject();
    delete userResponse.password;

    return res.status(201).json({
      success: true,
      message: 'User created successfully',
      user: userResponse,
    });
  } catch (error) {
    console.error('Admin Create User Error:', error);
    return res.status(500).json({ success: false, message: error.message || 'Failed to create user' });
  }
};

// @desc    Admin Edit User Personal Details
// @route   PUT /api/admin/users/:id
// @access  Private (Admin only)
const updateAdminUserDetails = async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    if (user.role === 'admin' && user._id.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Admin accounts cannot be edited by another admin.',
      });
    }

    const {
      firstName,
      lastName,
      phone,
      gender,
      dateOfBirth,
      address,
      isEmailVerified,
      verificationBadgeStatus,
      accountStatus,
      emergencyContact,
      caregiverType,
      relationshipToElderly,
      organizationName,
      volunteerIdType,
      volunteerIdNumber,
      educationalInstitution,
    } = req.body;

    if (firstName) user.firstName = firstName.trim();
    if (lastName) user.lastName = lastName.trim();
    if (phone) user.phone = phone.trim();
    if (gender) user.gender = gender;
    if (dateOfBirth) {
      user.dateOfBirth = new Date(dateOfBirth);
      user.age = calculateAge(user.dateOfBirth);
    }
    if (address) {
      user.address = { ...(user.address || {}), ...address };
    }
    if (typeof isEmailVerified === 'boolean') user.isEmailVerified = isEmailVerified;
    if (verificationBadgeStatus) user.verificationBadgeStatus = verificationBadgeStatus;
    if (accountStatus) user.accountStatus = accountStatus;

    if (emergencyContact) {
      user.emergencyContact = { ...(user.emergencyContact || {}), ...emergencyContact };
    }
    if (caregiverType !== undefined) user.caregiverType = caregiverType;
    if (relationshipToElderly !== undefined) user.relationshipToElderly = relationshipToElderly;
    if (organizationName !== undefined) user.organizationName = organizationName;
    if (volunteerIdType !== undefined) user.volunteerIdType = volunteerIdType;
    if (volunteerIdNumber !== undefined) user.volunteerIdNumber = volunteerIdNumber;
    if (educationalInstitution !== undefined) user.educationalInstitution = educationalInstitution;

    await user.save();

    return res.status(200).json({
      success: true,
      message: 'User details updated successfully',
      user,
    });
  } catch (error) {
    console.error('Admin Update User Error:', error);
    return res.status(500).json({ success: false, message: error.message || 'Failed to update user' });
  }
};

// @desc    Admin Ban User (Permanent or Temporary)
// @route   POST /api/admin/users/:id/ban
// @access  Private (Admin only)
const banUser = async (req, res) => {
  try {
    const { banType, duration, reason } = req.body;

    if (!reason || typeof reason !== 'string' || !reason.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Reason for ban is required.',
      });
    }

    if (req.params.id === req.user._id.toString()) {
      return res.status(400).json({ success: false, message: 'You cannot ban your own admin account.' });
    }

    const user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    if (user.role === 'admin') {
      return res.status(403).json({ success: false, message: 'Admin accounts cannot be banned.' });
    }

    let expiresAt = null;

    if (banType === 'temporary') {
      const now = new Date();
      if (duration === '1_day') {
        expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000);
      } else if (duration === '7_days' || duration === '1_week') {
        expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
      } else if (duration === '1_month' || duration === '30_days') {
        expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
      } else {
        return res.status(400).json({
          success: false,
          message: 'Invalid temporary ban duration. Use 1_day, 7_days, or 1_month.',
        });
      }
    } else if (banType !== 'permanent') {
      return res.status(400).json({
        success: false,
        message: 'Invalid banType. Must be either "permanent" or "temporary".',
      });
    }

    user.isBanned = true;
    user.banType = banType;
    user.banExpiresAt = expiresAt;
    user.bannedBy = req.user._id;
    user.banReason = reason || 'Violation of terms';
    await user.save();

    return res.status(200).json({
      success: true,
      message: `User has been ${banType === 'permanent' ? 'permanently' : 'temporarily'} banned.`,
      user,
    });
  } catch (error) {
    console.error('Ban User Error:', error);
    return res.status(500).json({ success: false, message: 'Failed to ban user' });
  }
};

// @desc    Admin Unban User
// @route   POST /api/admin/users/:id/unban
// @access  Private (Admin only)
const unbanUser = async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    user.isBanned = false;
    user.banType = 'none';
    user.banExpiresAt = null;
    user.bannedBy = null;
    user.banReason = '';
    await user.save();

    return res.status(200).json({
      success: true,
      message: 'User account unbanned successfully.',
      user,
    });
  } catch (error) {
    console.error('Unban User Error:', error);
    return res.status(500).json({ success: false, message: 'Failed to unban user' });
  }
};

module.exports = {
  getAdminUsers,
  getAdminUserDetails,
  createAdminUser,
  updateAdminUserDetails,
  banUser,
  unbanUser,
};
