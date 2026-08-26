// controllers/dependentsController.js
const User = require('../models/User');
const { generateHumanReadableId } = require('../utils/customIdGenerator');

// @desc    Get all linked dependents for logged-in caregiver
// @route   GET /api/caregiver/dependents
// @access  Private (Caregiver)
exports.getDependents = async (req, res) => {
  try {
    const dependents = await User.find({
      linkedCaregiverId: req.user._id,
      role: 'elderly',
    }).select('-password -resetPasswordOtpHash -resetPasswordOtpExpires -passwordResetSessionToken');

    res.status(200).json({
      success: true,
      count: dependents.length,
      data: dependents,
    });
  } catch (error) {
    console.error('Get Dependents Error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while fetching dependents',
    });
  }
};

// @desc    Add and link a new elderly dependent profile
// @route   POST /api/caregiver/dependents
// @access  Private (Caregiver)
exports.addDependent = async (req, res) => {
  try {
    const {
      firstName,
      lastName,
      email,
      phone,
      dateOfBirth,
      address,
      emergencyContact,
    } = req.body;

    if (!firstName || !lastName || !phone || !dateOfBirth || !address) {
      return res.status(400).json({
        success: false,
        message: 'Please provide all required fields (First name, Last name, DOB, Phone, Address)',
      });
    }

    // Generate unique email if not provided
    const randomSuffix = Math.floor(1000 + Math.random() * 9000);
    const resolvedEmail = email || `${firstName.toLowerCase()}.${lastName.toLowerCase()}.${randomSuffix}@togethercare.com`;

    const userExists = await User.findOne({ email: resolvedEmail.toLowerCase() });
    if (userExists) {
      return res.status(409).json({
        success: false,
        message: 'A user with this email already exists',
      });
    }

    const customId = await generateHumanReadableId('elderly');

    // Create the elderly user
    const elderly = await User.create({
      customId,
      firstName,
      lastName,
      email: resolvedEmail.toLowerCase(),
      password: 'elderly123', // default password
      phone,
      role: 'elderly',
      dateOfBirth,
      address,
      accountStatus: 'active', // Auto-activate profiles added by family caregivers
      emergencyContact: {
        name: emergencyContact?.name || `${req.user.firstName} ${req.user.lastName}`,
        relation: emergencyContact?.relation || 'Caregiver',
        phone: emergencyContact?.phone || req.user.phone,
      },
      linkedCaregiverId: req.user._id,
    });

    // Link in caregiver profile
    await User.findByIdAndUpdate(req.user._id, {
      $push: { linkedElderlyProfiles: elderly._id },
    });

    res.status(201).json({
      success: true,
      message: 'Elderly dependent profile created and linked successfully',
      data: elderly,
    });
  } catch (error) {
    console.error('Add Dependent Error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Server error while creating dependent profile',
    });
  }
};

// @desc    Get all elderly profiles that are not linked to any caregiver
// @route   GET /api/caregiver/dependents/unlinked
// @access  Private (Caregiver)
exports.getUnlinkedElderly = async (req, res) => {
  try {
    const unlinked = await User.find({
      role: 'elderly',
      $or: [
        { linkedCaregiverId: null },
        { linkedCaregiverId: { $exists: false } }
      ]
    }).select('firstName lastName customId phone address age');

    res.status(200).json({
      success: true,
      count: unlinked.length,
      data: unlinked,
    });
  } catch (error) {
    console.error('Get Unlinked Elderly Error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while fetching unlinked profiles',
    });
  }
};

// @desc    Link an existing elderly user to caregiver
// @route   POST /api/caregiver/dependents/link
// @access  Private (Caregiver)
exports.linkDependent = async (req, res) => {
  try {
    const { elderlyId } = req.body;

    if (!elderlyId) {
      return res.status(400).json({
        success: false,
        message: 'Please provide an elderly profile ID to link',
      });
    }

    const elderly = await User.findById(elderlyId);
    if (!elderly) {
      return res.status(404).json({
        success: false,
        message: 'Elderly profile not found',
      });
    }

    if (elderly.role !== 'elderly') {
      return res.status(400).json({
        success: false,
        message: 'Selected profile is not an elderly role',
      });
    }

    if (elderly.linkedCaregiverId) {
      return res.status(400).json({
        success: false,
        message: 'Selected elderly profile is already linked to another caregiver',
      });
    }

    // Link elderly to caregiver
    elderly.linkedCaregiverId = req.user._id;
    await elderly.save();

    // Link caregiver to elderly
    await User.findByIdAndUpdate(req.user._id, {
      $push: { linkedElderlyProfiles: elderly._id },
    });

    res.status(200).json({
      success: true,
      message: 'Elderly profile linked successfully',
      data: elderly,
    });
  } catch (error) {
    console.error('Link Dependent Error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while linking profile',
    });
  }
};
