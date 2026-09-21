// controllers/dependentsController.js
const User = require('../models/User');
const CompanionshipRequest = require('../models/CompanionshipRequest');
const HelpRequest = require('../models/HelpRequest');
const Activity = require('../models/Activity');
const { generateHumanReadableId } = require('../utils/customIdGenerator');
const { createNotification } = require('./notificationController');

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

// @desc    Request to link an existing elderly user to caregiver (Requires Elderly Approval)
// @route   POST /api/caregiver/dependents/request-link (or /link)
// @access  Private (Caregiver)
exports.requestLink = async (req, res) => {
  try {
    const elderlyId = req.body.elderlyId || req.body.seniorId;
    const relationship = req.body.relationship || req.user.relationshipToElderly || 'Family Member';

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
      if (elderly.linkedCaregiverId.toString() === req.user._id.toString()) {
        return res.status(400).json({
          success: false,
          message: 'You are already linked to this elderly person',
        });
      }
      return res.status(400).json({
        success: false,
        message: 'Selected elderly profile is already linked to another caregiver',
      });
    }

    // Initialize pendingCaregiverRequests array if undefined
    if (!elderly.pendingCaregiverRequests) {
      elderly.pendingCaregiverRequests = [];
    }

    const alreadyPending = elderly.pendingCaregiverRequests.some(
      (r) => r.caregiver && r.caregiver.toString() === req.user._id.toString()
    );
    if (alreadyPending) {
      return res.status(400).json({
        success: false,
        message: 'A link request has already been sent to this senior and is awaiting approval',
      });
    }

    // Add to pending requests
    elderly.pendingCaregiverRequests.push({
      caregiver: req.user._id,
      relationship,
      requestedAt: new Date(),
    });
    await elderly.save();

    // Create high-priority notification for the elderly user
    await createNotification({
      recipient: elderly._id,
      sender: req.user._id,
      senior: elderly._id,
      type: 'link_request',
      title: 'Family Caregiver Link Request',
      message: `${req.user.firstName} ${req.user.lastName} (${relationship}) has requested to link with your account as your family caregiver.`,
      data: {
        caregiverId: req.user._id,
        caregiverName: `${req.user.firstName} ${req.user.lastName}`,
        relationship,
        phone: req.user.phone,
      },
    });

    res.status(200).json({
      success: true,
      message: `Link request sent to ${elderly.firstName} ${elderly.lastName}. Awaiting senior approval.`,
      status: 'pending_approval',
      data: {
        seniorId: elderly._id,
        seniorName: `${elderly.firstName} ${elderly.lastName}`,
        status: 'pending_approval',
      },
    });
  } catch (error) {
    console.error('Request Link Error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while requesting profile link',
    });
  }
};

// Backwards-compatible alias for existing endpoints
exports.linkDependent = exports.requestLink;

// @desc    Elderly person accepts or declines a caregiver link request
// @route   POST /api/caregiver/dependents/respond-link
// @access  Private (Elderly, Caregiver, Admin)
exports.respondLink = async (req, res) => {
  try {
    const { caregiverId, action } = req.body;
    const seniorId = req.user.role === 'elderly' ? req.user._id : (req.body.seniorId || req.body.elderlyId);

    if (!caregiverId || !action) {
      return res.status(400).json({
        success: false,
        message: 'Please provide caregiverId and action (accept or reject)',
      });
    }

    if (!['accept', 'reject', 'approve', 'decline'].includes(action)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid action. Must be accept or reject.',
      });
    }

    const isAccept = action === 'accept' || action === 'approve';

    const elderly = await User.findById(seniorId);
    if (!elderly) {
      return res.status(404).json({
        success: false,
        message: 'Elderly profile not found',
      });
    }

    const caregiver = await User.findById(caregiverId);
    if (!caregiver) {
      return res.status(404).json({
        success: false,
        message: 'Caregiver profile not found',
      });
    }

    // Find the pending request to get relationship if specified
    const pendingReq = elderly.pendingCaregiverRequests?.find(
      (r) => r.caregiver && r.caregiver.toString() === caregiverId.toString()
    );
    const relationship = pendingReq?.relationship || caregiver.relationshipToElderly || 'Family Member';

    // Remove the request from elderly's pending requests
    elderly.pendingCaregiverRequests = (elderly.pendingCaregiverRequests || []).filter(
      (r) => r.caregiver && r.caregiver.toString() !== caregiverId.toString()
    );

    if (isAccept) {
      // Link elderly to caregiver
      elderly.linkedCaregiverId = caregiver._id;
      await elderly.save();

      // Link caregiver to elderly
      if (!caregiver.linkedElderlyProfiles) {
        caregiver.linkedElderlyProfiles = [];
      }
      if (!caregiver.linkedElderlyProfiles.some((id) => id.toString() === elderly._id.toString())) {
        caregiver.linkedElderlyProfiles.push(elderly._id);
        await caregiver.save();
      }

      // Notify Caregiver
      await createNotification({
        recipient: caregiver._id,
        sender: elderly._id,
        senior: elderly._id,
        type: 'link_approved',
        title: 'Senior Link Request Accepted 🎉',
        message: `${elderly.firstName} ${elderly.lastName} accepted your link request. You are now linked to oversee their care.`,
        data: {
          seniorId: elderly._id,
          seniorName: `${elderly.firstName} ${elderly.lastName}`,
          customId: elderly.customId,
        },
      });

      // Notify Elderly
      await createNotification({
        recipient: elderly._id,
        sender: caregiver._id,
        senior: elderly._id,
        type: 'link_approved',
        title: 'Family Caretaker Connected',
        message: `You are now linked with ${caregiver.firstName} ${caregiver.lastName} (${relationship}). They will help oversee your care.`,
        data: {
          caregiverId: caregiver._id,
          caregiverName: `${caregiver.firstName} ${caregiver.lastName}`,
          relationship,
          phone: caregiver.phone,
        },
      });

      return res.status(200).json({
        success: true,
        message: `Successfully linked with ${caregiver.firstName} ${caregiver.lastName}`,
        action: 'accepted',
        data: {
          linkedCaregiverId: caregiver._id,
          caregiver: {
            _id: caregiver._id,
            firstName: caregiver.firstName,
            lastName: caregiver.lastName,
            phone: caregiver.phone,
            email: caregiver.email,
            relationship,
            caregiverType: caregiver.caregiverType,
          },
        },
      });
    } else {
      // Declined
      await elderly.save();

      // Notify Caregiver
      await createNotification({
        recipient: caregiver._id,
        sender: elderly._id,
        senior: elderly._id,
        type: 'link_rejected',
        title: 'Link Request Declined',
        message: `${elderly.firstName} ${elderly.lastName} declined your caregiver link request.`,
        data: {
          seniorId: elderly._id,
          seniorName: `${elderly.firstName} ${elderly.lastName}`,
        },
      });

      return res.status(200).json({
        success: true,
        message: `Link request from ${caregiver.firstName} ${caregiver.lastName} was declined`,
        action: 'rejected',
      });
    }
  } catch (error) {
    console.error('Respond Link Error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while responding to link request',
    });
  }
};

// @desc    Get pending link requests (for elderly: requests received; for caregiver: requests sent)
// @route   GET /api/caregiver/dependents/pending-requests
// @access  Private (Elderly, Caregiver, Admin)
exports.getPendingRequests = async (req, res) => {
  try {
    if (req.user.role === 'elderly') {
      const userDoc = await User.findById(req.user._id)
        .populate('pendingCaregiverRequests.caregiver', 'firstName lastName phone email profilePicture relationshipToElderly caregiverType customId');
      return res.status(200).json({
        success: true,
        count: userDoc?.pendingCaregiverRequests?.length || 0,
        data: userDoc?.pendingCaregiverRequests || [],
      });
    } else {
      // Caregiver perspective: find elderly users who have a pending request from this caregiver
      const pendingSeniors = await User.find({
        'pendingCaregiverRequests.caregiver': req.user._id,
        role: 'elderly',
      }).select('firstName lastName customId phone address age pendingCaregiverRequests');

      const formatted = pendingSeniors.map((senior) => {
        const myReq = senior.pendingCaregiverRequests?.find(
          (r) => r.caregiver && r.caregiver.toString() === req.user._id.toString()
        );
        return {
          seniorId: senior._id,
          _id: senior._id,
          firstName: senior.firstName,
          lastName: senior.lastName,
          customId: senior.customId,
          phone: senior.phone,
          address: senior.address,
          age: senior.age,
          relationship: myReq?.relationship || 'Family Member',
          requestedAt: myReq?.requestedAt,
          status: 'pending_approval',
        };
      });

      return res.status(200).json({
        success: true,
        count: formatted.length,
        data: formatted,
      });
    }
  } catch (error) {
    console.error('Get Pending Requests Error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while fetching pending requests',
    });
  }
};

// @desc    Unlink an elderly dependent from logged-in caregiver or elderly unlinks caregiver
// @route   POST /api/caregiver/dependents/unlink
// @access  Private (Caregiver, Elderly, Admin)
exports.unlinkDependent = async (req, res) => {
  try {
    let elderlyId;
    let caregiverId;

    if (req.user.role === 'elderly') {
      elderlyId = req.user._id;
      const elderlyUser = await User.findById(elderlyId);
      caregiverId = elderlyUser?.linkedCaregiverId;
    } else {
      elderlyId = req.body.elderlyId || req.body.seniorId;
      caregiverId = req.user._id;
    }

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

    const actualCaregiverId = caregiverId || elderly.linkedCaregiverId;

    // Unlink elderly
    elderly.linkedCaregiverId = null;
    await elderly.save();

    // Remove from caregiver profile
    if (actualCaregiverId) {
      await User.findByIdAndUpdate(actualCaregiverId, {
        $pull: { linkedElderlyProfiles: elderly._id },
      });
    }

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

    // 1. Upcoming HelpRequests
    const helpRequests = await HelpRequest.find({
      $or: [
        ...(allSeniorIds.length > 0 ? [{ elderlyId: { $in: allSeniorIds } }] : []),
        { caregiverId: req.user._id },
      ],
      status: { $in: ['confirmed', 'matched', 'ongoing', 'arrived', 'searching'] },
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
