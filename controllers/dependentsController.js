// controllers/dependentsController.js
const User = require('../models/User');
const CompanionshipRequest = require('../models/CompanionshipRequest');
const HelpRequest = require('../models/HelpRequest');
const { generateHumanReadableId } = require('../utils/customIdGenerator');

// @desc    Get all linked dependents for logged-in caregiver
// @route   GET /api/caregiver/dependents
// @access  Private (Caregiver)
exports.getDependents = async (req, res) => {
  try {
    const userDoc = await User.findById(req.user._id);
    const linkedIds = userDoc?.linkedElderlyProfiles || [];

    const dependents = await User.find({
      $or: [
        { linkedCaregiverId: req.user._id },
        { _id: { $in: linkedIds } },
      ],
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
    const elderlyId = req.body.elderlyId || req.body.seniorId;

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

// @desc    Unlink an elderly dependent from logged-in caregiver
// @route   POST /api/caregiver/dependents/unlink
// @access  Private (Caregiver)
exports.unlinkDependent = async (req, res) => {
  try {
    const elderlyId = req.body.elderlyId || req.body.seniorId;

    if (!elderlyId) {
      return res.status(400).json({
        success: false,
        message: 'Please provide an elderly profile ID to unlink',
      });
    }

    const elderly = await User.findById(elderlyId);
    if (!elderly) {
      return res.status(404).json({
        success: false,
        message: 'Elderly profile not found',
      });
    }

    // Unlink elderly
    if (elderly.linkedCaregiverId && elderly.linkedCaregiverId.toString() === req.user._id.toString()) {
      elderly.linkedCaregiverId = null;
      await elderly.save();
    }

    // Remove from caregiver profile
    await User.findByIdAndUpdate(req.user._id, {
      $pull: { linkedElderlyProfiles: elderly._id },
    });

    res.status(200).json({
      success: true,
      message: 'Elderly dependent unlinked successfully',
    });
  } catch (error) {
    console.error('Unlink Dependent Error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while unlinking dependent profile',
    });
  }
};

// @desc    Get activities and tasks for a linked senior (Sprint 3: Monitor senior tasks)
// @route   GET /api/caregiver/dependents/:id/activities
// @access  Private (Caregiver)
exports.getDependentActivities = async (req, res) => {
  try {
    const elderlyId = req.params.id;

    // Verify access
    const caregiver = await User.findById(req.user._id);
    const isLinked =
      caregiver.linkedElderlyProfiles?.some((id) => id.toString() === elderlyId) ||
      (await User.findOne({ _id: elderlyId, linkedCaregiverId: req.user._id }));

    if (!isLinked) {
      return res.status(403).json({
        success: false,
        message: 'Unauthorized access to dependent activities',
      });
    }

    const senior = await User.findById(elderlyId).select(
      'firstName lastName customId phone address interests'
    );

    // Fetch companionship requests (chats, walks, hobbies)
    const companionshipRequests = await CompanionshipRequest.find({ elderly: elderlyId })
      .populate('volunteer', 'firstName lastName phone profilePicture verificationBadgeStatus')
      .populate('activityId', 'name icon iconFamily')
      .sort({ scheduledDate: -1 });

    // Fetch help requests (groceries, medicine, etc.)
    const helpRequests = await HelpRequest.find({ elderlyId })
      .populate('volunteerId', 'firstName lastName phone profilePicture verificationBadgeStatus')
      .sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      data: {
        senior,
        companionshipRequests,
        helpRequests,
        interests: senior?.interests || [],
      },
    });
  } catch (error) {
    console.error('Get Dependent Activities Error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while fetching dependent activities',
      error: error.message,
    });
  }
};

// @desc    Get all upcoming care visits across all linked seniors (US-404)
// @route   GET /api/caregiver/dependents/upcoming-visits
// @access  Private (Caregiver)
exports.getUpcomingCareVisits = async (req, res) => {
  try {
    const caregiver = await User.findById(req.user._id);
    const linkedIds = caregiver?.linkedElderlyProfiles || [];

    // Also include any senior with linkedCaregiverId = caregiver._id
    const additionalLinked = await User.find({
      linkedCaregiverId: req.user._id,
      role: 'elderly',
    }).select('_id');

    const allSeniorIds = Array.from(
      new Set([...linkedIds.map((id) => id.toString()), ...additionalLinked.map((u) => u._id.toString())])
    );

    if (allSeniorIds.length === 0) {
      return res.status(200).json({
        success: true,
        count: 0,
        data: [],
      });
    }

    // 1. Upcoming HelpRequests
    const helpRequests = await HelpRequest.find({
      elderlyId: { $in: allSeniorIds },
      status: { $in: ['confirmed', 'matched', 'arrived', 'searching'] },
    })
      .populate('elderlyId', 'firstName lastName customId phone address')
      .populate('volunteerId', 'firstName lastName phone profilePicture verificationBadgeStatus averageRating')
      .sort({ date: 1, time: 1 });

    // 2. Upcoming CompanionshipRequests
    const companionshipVisits = await CompanionshipRequest.find({
      elderly: { $in: allSeniorIds },
      status: { $in: ['accepted', 'pending'] },
    })
      .populate('elderly', 'firstName lastName customId phone address')
      .populate('volunteer', 'firstName lastName phone profilePicture verificationBadgeStatus')
      .populate('activityId', 'name icon iconFamily')
      .sort({ scheduledDate: 1 });

    // Format into unified upcoming visits
    const unifiedVisits = [
      ...helpRequests.map((hr) => ({
        id: hr._id,
        _id: hr._id,
        type: 'help_request',
        serviceType: hr.serviceType,
        date: hr.date,
        time: hr.time,
        location: hr.location,
        status: hr.status,
        senior: hr.elderlyId,
        volunteer: hr.volunteerId,
        assignedVolunteer: hr.volunteerId,
        sosTriggered: hr.sosTriggered,
        createdAt: hr.createdAt,
      })),
      ...companionshipVisits.map((cv) => ({
        id: cv._id,
        _id: cv._id,
        type: 'companionship',
        serviceType: cv.activityType || 'Companionship',
        date: cv.scheduledDate ? new Date(cv.scheduledDate).toISOString().split('T')[0] : '',
        time: cv.startTime || cv.timeSlot || '02:00 PM',
        location: cv.location || cv.elderly?.address?.streetAddress || '',
        status: cv.status,
        senior: cv.elderly,
        volunteer: cv.volunteer,
        assignedVolunteer: cv.volunteer,
        activity: cv.activityId,
        createdAt: cv.createdAt,
      })),
    ];

    // Sort by date and time
    unifiedVisits.sort((a, b) => new Date(`${a.date} ${a.time}`) - new Date(`${b.date} ${b.time}`));

    res.status(200).json({
      success: true,
      count: unifiedVisits.length,
      data: unifiedVisits,
    });
  } catch (error) {
    console.error('Get Upcoming Care Visits Error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while fetching upcoming care visits',
      error: error.message,
    });
  }
};
