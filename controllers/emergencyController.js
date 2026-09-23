// controllers/emergencyController.js
const EmergencyAlert = require('../models/EmergencyAlert');
const User = require('../models/User');
const { createNotification } = require('./notificationController');

// @desc    Trigger emergency SOS alert
// @route   POST /api/emergency/sos
// @access  Private (Elderly / Caregiver)
exports.triggerSOS = async (req, res) => {
  try {
    const userId = req.user._id;
    const { emergencyType, location, coordinates, resolutionNotes } = req.body;

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    // Check if there is already an active alert for this user
    let existingActive = await EmergencyAlert.findOne({
      user: userId,
      status: 'active',
    });

    if (existingActive) {
      return res.status(200).json({
        success: true,
        message: '🚨 Emergency SOS is already active!',
        data: existingActive,
      });
    }

    // Create new emergency alert
    const newAlert = await EmergencyAlert.create({
      user: userId,
      emergencyType: emergencyType || 'general',
      status: 'active',
      location: typeof location === 'string'
        ? location
        : (location?.address || (typeof user.address === 'string' ? user.address : `${user.address?.streetAddress || ''}, ${user.address?.city || ''}`.trim())),
      coordinates: coordinates || (location?.latitude ? { latitude: location.latitude, longitude: location.longitude } : {}),
      emergencyContact: {
        name: user.emergencyContact?.name || '',
        relation: user.emergencyContact?.relation || '',
        phone: user.emergencyContact?.phone || '',
      },
      linkedCaregiver: user.linkedCaregiverId || null,
      triggeredAt: new Date(),
    });

    // Notify all linked family members / caregivers
    const familyMembers = await User.find({
      $or: [
        { _id: user.linkedCaregiverId },
        { linkedElderlyProfiles: userId },
      ],
    });

    for (const fm of familyMembers) {
      await createNotification({
        recipient: fm._id,
        sender: userId,
        senior: userId,
        type: 'sos_alert',
        title: '🚨 EMERGENCY SOS ALERT!',
        message: `${user.firstName} ${user.lastName || ''} has triggered an Emergency SOS! Immediate attention required.`,
        data: { alertId: newAlert._id, location: newAlert.location },
      });
    }

    res.status(201).json({
      success: true,
      message: '🚨 Emergency SOS Broadcast Triggered. Urgent help is requested!',
      data: newAlert,
    });
  } catch (error) {
    console.error('Trigger Emergency SOS Error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while triggering emergency SOS',
      error: error.message,
    });
  }
};

// @desc    Get currently active SOS alert for logged in user
// @route   GET /api/emergency/active
// @access  Private
exports.getActiveSOS = async (req, res) => {
  try {
    const userId = req.user._id;

    // Check if user has active alert or if caregiver has linked senior with active alert
    let alert = await EmergencyAlert.findOne({
      user: userId,
      status: 'active',
    }).populate('user', 'firstName lastName phone address emergencyContact');

    if (!alert && req.user.role === 'caregiver') {
      const caregiver = await User.findById(userId);
      const seniorIds = caregiver?.linkedElderlyProfiles || [];

      alert = await EmergencyAlert.findOne({
        $or: [
          { linkedCaregiver: userId },
          { user: { $in: seniorIds } },
        ],
        status: 'active',
      }).populate('user', 'firstName lastName phone address emergencyContact');
    }

    res.status(200).json({
      success: true,
      data: alert || null,
    });
  } catch (error) {
    console.error('Get Active SOS Error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while fetching active SOS',
      error: error.message,
    });
  }
};

// @desc    Resolve / Cancel emergency SOS alert
// @route   POST /api/emergency/resolve (or POST /api/emergency/:id/resolve)
// @access  Private
exports.resolveSOS = async (req, res) => {
  try {
    const alertId = req.params.id;
    const { resolutionNotes, status } = req.body;

    let query = {};
    if (alertId) {
      query._id = alertId;
    } else {
      query.user = req.user._id;
      query.status = 'active';
    }

    const alert = await EmergencyAlert.findOne(query);

    if (!alert) {
      return res.status(404).json({
        success: false,
        message: 'No matching active emergency SOS alert found to resolve',
      });
    }

    alert.status = status || 'resolved';
    alert.resolvedAt = new Date();
    if (resolutionNotes) {
      alert.resolutionNotes = resolutionNotes;
    }
    await alert.save();

    res.status(200).json({
      success: true,
      message: 'Emergency SOS alert resolved. You are marked safe.',
      data: alert,
    });
  } catch (error) {
    console.error('Resolve SOS Error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while resolving SOS alert',
      error: error.message,
    });
  }
};

// @desc    Get emergency alerts history (for admin or user)
// @route   GET /api/emergency/history
// @access  Private
exports.getEmergencyHistory = async (req, res) => {
  try {
    let query = {};
    if (req.user.role === 'elderly') {
      query.user = req.user._id;
    } else if (req.user.role === 'caregiver') {
      query.$or = [{ user: req.user._id }, { linkedCaregiver: req.user._id }];
    }
    // Admin sees all

    const history = await EmergencyAlert.find(query)
      .sort({ triggeredAt: -1 })
      .limit(50)
      .populate('user', 'firstName lastName phone address');

    res.status(200).json({
      success: true,
      count: history.length,
      data: history,
    });
  } catch (error) {
    console.error('Get Emergency History Error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while fetching emergency history',
      error: error.message,
    });
  }
};

// ==========================================
// CARE CIRCLE / EMERGENCY CONTACTS ENDPOINTS
// ==========================================

// @desc    Get all Care Circle emergency contacts for current user
// @route   GET /api/emergency/care-circle
// @access  Private
exports.getCareCircle = async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select('careCircle emergencyContact firstName lastName phone');
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    let contacts = user.careCircle || [];

    // Auto-migrate single legacy emergencyContact if careCircle array is empty
    if (contacts.length === 0 && user.emergencyContact?.phone) {
      user.careCircle = [
        {
          name: user.emergencyContact.name || 'Primary Contact',
          relation: user.emergencyContact.relation || 'Family Member',
          phone: user.emergencyContact.phone,
          isPrimary: true,
          notes: 'Migrated from primary emergency contact',
          createdAt: new Date(),
        },
      ];
      await user.save();
      contacts = user.careCircle;
    }

    res.status(200).json({
      success: true,
      count: contacts.length,
      data: contacts,
    });
  } catch (error) {
    console.error('Get Care Circle Error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while fetching Care Circle contacts',
      error: error.message,
    });
  }
};

// @desc    Add a new emergency contact to Care Circle
// @route   POST /api/emergency/care-circle
// @access  Private
exports.addCareCircleContact = async (req, res) => {
  try {
    const { name, relation, phone, isPrimary, notes } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ success: false, message: 'Contact name is required' });
    }
    if (!phone || !phone.trim()) {
      return res.status(400).json({ success: false, message: 'Phone number is required' });
    }

    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    if (!user.careCircle) {
      user.careCircle = [];
    }

    const shouldBePrimary = isPrimary || user.careCircle.length === 0;

    // If making this primary, reset other primary flags
    if (shouldBePrimary) {
      user.careCircle.forEach((c) => {
        c.isPrimary = false;
      });
      user.emergencyContact = {
        name: name.trim(),
        relation: (relation || 'Family Member').trim(),
        phone: phone.trim(),
      };
    }

    const newContact = {
      name: name.trim(),
      relation: (relation || 'Family Member').trim(),
      phone: phone.trim(),
      isPrimary: shouldBePrimary,
      notes: (notes || '').trim(),
      createdAt: new Date(),
    };

    user.careCircle.push(newContact);
    await user.save();

    res.status(201).json({
      success: true,
      message: `${name} has been added to your Care Circle.`,
      data: user.careCircle,
    });
  } catch (error) {
    console.error('Add Care Circle Contact Error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while adding contact to Care Circle',
      error: error.message,
    });
  }
};

// @desc    Update a Care Circle emergency contact
// @route   PUT /api/emergency/care-circle/:id
// @access  Private
exports.updateCareCircleContact = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, relation, phone, isPrimary, notes } = req.body;

    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const contact = user.careCircle.id(id);
    if (!contact) {
      return res.status(404).json({ success: false, message: 'Contact not found in Care Circle' });
    }

    if (name) contact.name = name.trim();
    if (relation !== undefined) contact.relation = relation.trim();
    if (phone) contact.phone = phone.trim();
    if (notes !== undefined) contact.notes = notes.trim();

    if (isPrimary !== undefined) {
      if (isPrimary) {
        user.careCircle.forEach((c) => {
          c.isPrimary = false;
        });
        contact.isPrimary = true;
        user.emergencyContact = {
          name: contact.name,
          relation: contact.relation,
          phone: contact.phone,
        };
      } else {
        contact.isPrimary = false;
      }
    }

    await user.save();

    res.status(200).json({
      success: true,
      message: 'Care Circle contact updated successfully.',
      data: user.careCircle,
    });
  } catch (error) {
    console.error('Update Care Circle Contact Error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while updating contact',
      error: error.message,
    });
  }
};

// @desc    Delete a Care Circle emergency contact
// @route   DELETE /api/emergency/care-circle/:id
// @access  Private
exports.deleteCareCircleContact = async (req, res) => {
  try {
    const { id } = req.params;

    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const contact = user.careCircle.id(id);
    if (!contact) {
      return res.status(404).json({ success: false, message: 'Contact not found' });
    }

    const wasPrimary = contact.isPrimary;
    contact.deleteOne();

    // If deleted contact was primary, assign first remaining contact as primary
    if (wasPrimary && user.careCircle.length > 0) {
      user.careCircle[0].isPrimary = true;
      user.emergencyContact = {
        name: user.careCircle[0].name,
        relation: user.careCircle[0].relation,
        phone: user.careCircle[0].phone,
      };
    } else if (user.careCircle.length === 0) {
      user.emergencyContact = { name: '', relation: '', phone: '' };
    }

    await user.save();

    res.status(200).json({
      success: true,
      message: 'Contact removed from Care Circle.',
      data: user.careCircle,
    });
  } catch (error) {
    console.error('Delete Care Circle Contact Error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while deleting contact',
      error: error.message,
    });
  }
};

// @desc    Set a Care Circle contact as Primary Emergency Contact
// @route   PATCH /api/emergency/care-circle/:id/primary
// @access  Private
exports.setPrimaryCareCircleContact = async (req, res) => {
  try {
    const { id } = req.params;

    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const contact = user.careCircle.id(id);
    if (!contact) {
      return res.status(404).json({ success: false, message: 'Contact not found' });
    }

    user.careCircle.forEach((c) => {
      c.isPrimary = false;
    });
    contact.isPrimary = true;

    user.emergencyContact = {
      name: contact.name,
      relation: contact.relation,
      phone: contact.phone,
    };

    await user.save();

    res.status(200).json({
      success: true,
      message: `${contact.name} is now your primary emergency contact.`,
      data: user.careCircle,
    });
  } catch (error) {
    console.error('Set Primary Contact Error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while updating primary contact',
      error: error.message,
    });
  }
};
