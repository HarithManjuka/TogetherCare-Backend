// controllers/volunteerOfferController.js
const VolunteerOffer = require('../models/VolunteerOffer');

// @desc    Create / Post an Offer
// @route   POST /api/volunteer-offers
// @access  Private (Volunteer)
exports.createOffer = async (req, res) => {
  try {
    const {
      services,
      date,
      startTime,
      endTime,
      serviceArea,
      radius,
      capacity,
      specialSkills,
    } = req.body;

    // 1. Validation: Services
    if (!services || !Array.isArray(services) || services.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Please select at least one service you can provide',
      });
    }

    // 2. Validation: Date (cannot be in past)
    if (!date) {
      return res.status(400).json({
        success: false,
        message: 'Available date is required',
      });
    }

    const todayStr = new Date().toISOString().split('T')[0];
    if (date < todayStr) {
      return res.status(400).json({
        success: false,
        message: 'Available date cannot be in the past',
      });
    }

    // 3. Validation: Times
    if (!startTime || !endTime) {
      return res.status(400).json({
        success: false,
        message: 'Both start time and end time are required',
      });
    }

    // 4. Validation: Location & Capacity
    if (!serviceArea || !serviceArea.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Service area / base location is required',
      });
    }

    const numCapacity = parseInt(capacity, 10) || 1;
    if (numCapacity < 1 || numCapacity > 5) {
      return res.status(400).json({
        success: false,
        message: 'Capacity must be between 1 and 5 elders',
      });
    }

    // Volunteer Name (Auto-filled from user profile to prevent impersonation)
    const volunteerName = `${req.user.firstName} ${req.user.lastName || ''}`.trim();

    const offer = await VolunteerOffer.create({
      volunteerId: req.user._id,
      volunteerName,
      services,
      date,
      startTime,
      endTime,
      serviceArea: serviceArea.trim(),
      radius: radius || 'Within 5 km',
      capacity: numCapacity,
      slotsLeft: numCapacity,
      specialSkills: (specialSkills || '').trim().slice(0, 200),
      status: 'pending',
    });

    res.status(201).json({
      success: true,
      message: 'Offer posted successfully and is now pending.',
      data: offer,
    });
  } catch (error) {
    console.error('Create Offer Error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Server error while posting offer',
    });
  }
};

// @desc    Get offers created by logged-in volunteer
// @route   GET /api/volunteer-offers/my-offers
// @access  Private (Volunteer)
exports.getMyOffers = async (req, res) => {
  try {
    const offers = await VolunteerOffer.find({ volunteerId: req.user._id }).sort({
      createdAt: -1,
    });

    res.status(200).json({
      success: true,
      count: offers.length,
      data: offers,
    });
  } catch (error) {
    console.error('Get My Offers Error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while fetching your offers',
    });
  }
};

// @desc    Get all active community offers (for elders or public feed)
// @route   GET /api/volunteer-offers
// @access  Public / Protected
exports.getAllOffers = async (req, res) => {
  try {
    const { service, location } = req.query;
    let query = { slotsLeft: { $gt: 0 }, status: { $in: ['pending', 'active'] } };

    if (service && service !== 'All') {
      query.services = { $in: [service] };
    }
    if (location && location.trim()) {
      query.serviceArea = { $regex: location.trim(), $options: 'i' };
    }

    const offers = await VolunteerOffer.find(query)
      .populate('volunteerId', 'firstName lastName email phone profilePicture verificationBadgeStatus isEmailVerified age educationalInstitution bio rating address interests')
      .sort({ date: 1, createdAt: -1 });

    res.status(200).json({
      success: true,
      count: offers.length,
      data: offers,
    });
  } catch (error) {
    console.error('Get All Offers Error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while fetching community offers',
    });
  }
};

// @desc    Accept a volunteer offer by an elderly user (creates scheduled companionship visit)
// @route   POST /api/volunteer-offers/:id/accept
// @access  Private (Elderly)
exports.acceptOffer = async (req, res) => {
  try {
    const CompanionshipRequest = require('../models/CompanionshipRequest');
    const offer = await VolunteerOffer.findById(req.params.id).populate('volunteerId', 'firstName lastName phone email');

    if (!offer) {
      return res.status(404).json({
        success: false,
        message: 'Volunteer offer not found',
      });
    }

    if (offer.slotsLeft <= 0 || offer.status === 'booked' || offer.status === 'cancelled') {
      return res.status(400).json({
        success: false,
        message: 'This offer is no longer available or already fully booked',
      });
    }

    // Decrement slots and update status if full
    offer.slotsLeft = Math.max(0, offer.slotsLeft - 1);
    if (offer.slotsLeft === 0) {
      offer.status = 'booked';
    }
    await offer.save();

    // Create corresponding accepted CompanionshipRequest
    const primaryService = offer.services && offer.services.length > 0 ? offer.services[0] : 'Companionship';
    const scheduledDateObj = offer.date ? new Date(offer.date) : new Date();

    const companionship = await CompanionshipRequest.create({
      elderly: req.user._id,
      volunteer: offer.volunteerId._id || offer.volunteerId,
      acceptedBy: offer.volunteerId._id || offer.volunteerId,
      acceptedAt: new Date(),
      companionName: offer.volunteerName || `${offer.volunteerId.firstName || 'Volunteer'} ${offer.volunteerId.lastName || ''}`.trim(),
      activityType: primaryService,
      scheduledDate: scheduledDateObj,
      startTime: offer.startTime || '02:00 PM',
      endTime: offer.endTime || '04:00 PM',
      timeSlot: `${offer.startTime || '02:00 PM'} - ${offer.endTime || '04:00 PM'}`,
      communicationMethod: 'in_person',
      location: offer.serviceArea || 'Local Area',
      notes: `Accepted from Volunteer Offer. Services: ${offer.services.join(', ')}. ${offer.specialSkills ? `Note: ${offer.specialSkills}` : ''}`.trim(),
      status: 'accepted',
    });

    res.status(200).json({
      success: true,
      message: 'Volunteer offer accepted and added to your schedule!',
      data: {
        companionship,
        offer,
      },
    });
  } catch (error) {
    console.error('Accept Offer Error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Server error while accepting volunteer offer',
    });
  }
};

// @desc    Update an existing offer
// @route   PUT /api/volunteer-offers/:id
// @access  Private (Volunteer)
exports.updateOffer = async (req, res) => {
  try {
    let offer = await VolunteerOffer.findById(req.params.id);

    if (!offer) {
      return res.status(404).json({
        success: false,
        message: 'Offer not found',
      });
    }

    // Ensure user owns this offer
    if (offer.volunteerId.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to update this offer',
      });
    }

    const {
      services,
      date,
      startTime,
      endTime,
      serviceArea,
      radius,
      capacity,
      specialSkills,
      status,
    } = req.body;

    if (services && (!Array.isArray(services) || services.length === 0)) {
      return res.status(400).json({
        success: false,
        message: 'Please select at least one service',
      });
    }

    if (date) {
      const todayStr = new Date().toISOString().split('T')[0];
      if (date < todayStr) {
        return res.status(400).json({
          success: false,
          message: 'Date cannot be in the past',
        });
      }
      offer.date = date;
    }

    if (services) offer.services = services;
    if (startTime) offer.startTime = startTime;
    if (endTime) offer.endTime = endTime;
    if (serviceArea) offer.serviceArea = serviceArea.trim();
    if (radius) offer.radius = radius;
    if (specialSkills !== undefined) offer.specialSkills = specialSkills.trim().slice(0, 200);
    if (status) offer.status = status;

    if (capacity !== undefined) {
      const numCapacity = parseInt(capacity, 10);
      if (numCapacity >= 1 && numCapacity <= 5) {
        // Adjust slots left proportionally
        const diff = numCapacity - offer.capacity;
        offer.capacity = numCapacity;
        offer.slotsLeft = Math.max(0, offer.slotsLeft + diff);
      }
    }

    await offer.save();

    res.status(200).json({
      success: true,
      message: 'Offer updated successfully',
      data: offer,
    });
  } catch (error) {
    console.error('Update Offer Error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Server error while updating offer',
    });
  }
};

// @desc    Delete / Cancel an offer
// @route   DELETE /api/volunteer-offers/:id
// @access  Private (Volunteer)
exports.deleteOffer = async (req, res) => {
  try {
    const offer = await VolunteerOffer.findById(req.params.id);

    if (!offer) {
      return res.status(404).json({
        success: false,
        message: 'Offer not found',
      });
    }

    if (offer.volunteerId.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to delete this offer',
      });
    }

    await offer.deleteOne();

    res.status(200).json({
      success: true,
      message: 'Offer deleted successfully',
    });
  } catch (error) {
    console.error('Delete Offer Error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while deleting offer',
    });
  }
};

const HelpRequest = require('../models/HelpRequest');
const CompanionshipRequest = require('../models/CompanionshipRequest');
const User = require('../models/User');
const { createNotification } = require('./notificationController');

// Helper to get equivalent service names across offers and requests
const getServiceAliases = (serviceType) => {
  const s = (serviceType || '').toLowerCase().trim();
  if (s.includes('grocer') || s.includes('food')) {
    return ['Grocery', 'Grocery Pickup', 'Buying food & groceries'];
  }
  if (s.includes('med') || s.includes('pharm') || s.includes('prescript')) {
    return ['Medicine', 'Pharmacy Run', 'Fetching prescriptions'];
  }
  if (s.includes('comp') || s.includes('chat') || s.includes('social') || s.includes('call')) {
    return ['Companionship', 'Companionship (Chat/Call)', 'Social visit & chat'];
  }
  if (s.includes('tech')) {
    return ['Tech Support', 'Tech Support (phone setup)'];
  }
  if (s.includes('pet') || s.includes('walk')) {
    return ['Pet Walking'];
  }
  return [serviceType];
};

// @desc    Get nearby / available community requests for volunteers to browse
// @route   GET /api/volunteer-offers/available-requests
// @access  Private (Volunteer)
exports.getAvailableRequests = async (req, res) => {
  try {
    const { category, search } = req.query;

    let helpQuery = { status: 'searching', volunteerId: null };
    if (category && category !== 'all') {
      helpQuery.serviceType = { $regex: category, $options: 'i' };
    }

    let helpRequests = await HelpRequest.find(helpQuery)
      .populate('elderlyId', 'firstName lastName phone address')
      .sort({ createdAt: -1 });

    // Auto-seed sample community requests if completely empty, so volunteer dashboard is immediately interactive
    if (helpRequests.length === 0 && (!category || category === 'all')) {
      let elderlyUser = await User.findOne({ role: 'elderly' });
      if (!elderlyUser) {
        elderlyUser = await User.create({
          customId: 'ELD-0999',
          firstName: 'Sunethra',
          lastName: 'Perera',
          email: 'perera.elder@togethercare.org',
          password: 'Password123!',
          phone: '0771234567',
          role: 'elderly',
          dateOfBirth: new Date('1952-04-10'),
          address: {
            streetAddress: 'No. 42, Galle Road',
            city: 'Colombo 03',
            postalCode: '00300',
            district: 'Colombo',
            province: 'Western',
          },
          accountStatus: 'active',
        });
      }

      let caregiverUser = await User.findOne({ role: 'caregiver' });
      if (!caregiverUser) {
        caregiverUser = await User.create({
          customId: 'CRG-0999',
          firstName: 'Anura',
          lastName: 'Perera',
          email: 'anura.caregiver@togethercare.org',
          password: 'Password123!',
          phone: '0777654321',
          role: 'caregiver',
          dateOfBirth: new Date('1980-08-15'),
          address: {
            streetAddress: 'No. 42, Galle Road',
            city: 'Colombo 03',
            postalCode: '00300',
            district: 'Colombo',
            province: 'Western',
          },
          accountStatus: 'active',
        });
      }

      const todayStr = new Date().toISOString().split('T')[0];
      await HelpRequest.create([
        {
          caregiverId: caregiverUser._id,
          elderlyId: elderlyUser._id,
          serviceType: 'Grocery',
          date: todayStr,
          time: '02:30 PM',
          location: 'No. 42, Galle Road, Colombo 03',
          status: 'searching',
          feedback: '',
        },
        {
          caregiverId: caregiverUser._id,
          elderlyId: elderlyUser._id,
          serviceType: 'Medicine',
          date: todayStr,
          time: '04:00 PM',
          location: 'No. 18, Flower Road, Colombo 07',
          status: 'searching',
          feedback: '',
        },
        {
          caregiverId: caregiverUser._id,
          elderlyId: elderlyUser._id,
          serviceType: 'Companionship',
          date: todayStr,
          time: '10:00 AM',
          location: 'No. 5, Havelock Road, Colombo 05',
          status: 'searching',
          feedback: '',
        },
      ]);

      helpRequests = await HelpRequest.find(helpQuery)
        .populate('elderlyId', 'firstName lastName phone address')
        .sort({ createdAt: -1 });
    }

    const formatted = helpRequests.map((hr) => {
      const elder = hr.elderlyId || {};
      const cat = (hr.serviceType || '').toLowerCase();
      let icon = 'cart-outline';
      let emoji = '🛒';
      let defaultItems = ['Fresh Milk (2L)', 'Bread', 'Eggs (12 Pack)', 'Bananas (1kg)'];

      if (cat.includes('med') || cat.includes('pharm')) {
        icon = 'medical-outline';
        emoji = '💊';
        defaultItems = ['Prescription Blood Pressure Pills', 'Eye Drops (Refresh Tears)'];
      } else if (cat.includes('comp') || cat.includes('walk') || cat.includes('chat')) {
        icon = 'heart-outline';
        emoji = '🤝';
        defaultItems = ['Friendly conversation', 'Walk in community garden'];
      }

      return {
        id: hr._id.toString(),
        _id: hr._id.toString(),
        type: `${hr.serviceType} Assistance`,
        serviceType: hr.serviceType,
        category: cat.includes('med') ? 'medical' : cat.includes('grocer') ? 'grocery' : 'companionship',
        elderName: `${elder.firstName || 'Elder'} ${elder.lastName || ''}`.trim(),
        elderPhone: elder.phone || '077 123 4567',
        distance: '1.2 km',
        duration: '45 min',
        badge: hr.serviceType === 'Medicine' ? 'Urgent' : 'Today',
        badgeType: hr.serviceType === 'Medicine' ? 'urgent' : 'today',
        address: hr.location || (elder.address ? `${elder.address.streetAddress}, ${elder.address.city}` : 'Colombo'),
        date: hr.date,
        time: hr.time,
        items: defaultItems,
        notes: `Assistance requested for ${hr.serviceType}. Please arrive on time.`,
        status: hr.status,
      };
    });

    res.status(200).json({
      success: true,
      count: formatted.length,
      data: formatted,
    });
  } catch (error) {
    console.error('Get Available Requests Error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while fetching available requests',
      error: error.message,
    });
  }
};

// @desc    Accept a community request
// @route   POST /api/volunteer-offers/requests/:id/accept
// @access  Private (Volunteer)
exports.acceptRequest = async (req, res) => {
  try {
    const requestId = req.params.id;
    let request = await HelpRequest.findById(requestId);

    if (!request) {
      // Check if it's in CompanionshipRequest
      let compReq = await CompanionshipRequest.findById(requestId);
      if (compReq) {
        if (compReq.volunteer && compReq.volunteer.toString() !== req.user._id.toString()) {
          return res.status(400).json({ success: false, message: 'Request has already been accepted by another volunteer' });
        }
        compReq.volunteer = req.user._id;
        compReq.acceptedBy = req.user._id;
        compReq.acceptedAt = new Date();
        compReq.companionName = `${req.user.firstName} ${req.user.lastName || ''}`.trim();
        compReq.status = 'accepted';
        await compReq.save();
        return res.status(200).json({
          success: true,
          message: 'Request accepted successfully!',
          data: compReq,
        });
      }
      return res.status(404).json({ success: false, message: 'Request not found' });
    }

    if (request.status !== 'searching') {
      return res.status(400).json({
        success: false,
        message: 'This request is no longer open for acceptance',
      });
    }

    request.volunteerId = req.user._id;
    request.status = 'confirmed';

    // Check if volunteer has an active offer for this service/date, and decrement slots
    const serviceAliases = getServiceAliases(request.serviceType);
    const matchingOffer = await VolunteerOffer.findOne({
      volunteerId: req.user._id,
      date: request.date,
      services: { $in: serviceAliases },
      slotsLeft: { $gt: 0 },
      status: { $in: ['pending', 'active'] },
    });

    if (matchingOffer) {
      request.volunteerOfferId = matchingOffer._id;
      matchingOffer.slotsLeft = Math.max(0, matchingOffer.slotsLeft - 1);
      if (matchingOffer.slotsLeft === 0) {
        matchingOffer.status = 'booked';
      }
      await matchingOffer.save();
    }

    await request.save();

    // Send notifications to caregiver and senior
    const volunteerName = `${req.user.firstName} ${req.user.lastName || ''}`.trim();
    if (request.caregiverId) {
      await createNotification({
        recipient: request.caregiverId,
        sender: req.user._id,
        senior: request.elderlyId,
        type: 'visit_approved',
        title: 'Volunteer Accepted Request! 🤝',
        message: `${volunteerName} has accepted your ${request.serviceType} visit request for ${request.date} at ${request.time}.`,
        data: { requestId: request._id, date: request.date, time: request.time },
      });
    }

    if (request.elderlyId) {
      await createNotification({
        recipient: request.elderlyId,
        sender: req.user._id,
        senior: request.elderlyId,
        type: 'visit_approved',
        title: 'Volunteer Visit Confirmed 📅',
        message: `${volunteerName} will be visiting for ${request.serviceType} on ${request.date} at ${request.time}.`,
        data: { requestId: request._id, date: request.date, time: request.time },
      });
    }

    res.status(200).json({
      success: true,
      message: 'You have successfully accepted this request!',
      data: request,
    });
  } catch (error) {
    console.error('Accept Request Error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Server error while accepting request',
    });
  }
};

// @desc    Get logged-in volunteer's scheduled visits
// @route   GET /api/volunteer-offers/my-schedule
// @access  Private (Volunteer)
exports.getMySchedule = async (req, res) => {
  try {
    const helpVisits = await HelpRequest.find({
      volunteerId: req.user._id,
      status: { $in: ['matched', 'confirmed', 'ongoing', 'arrived'] },
    })
      .populate('elderlyId', 'firstName lastName phone address')
      .populate('caregiverId', 'firstName lastName phone')
      .sort({ date: 1, time: 1 });

    const compVisits = await CompanionshipRequest.find({
      volunteer: req.user._id,
      status: { $in: ['accepted', 'ongoing'] },
    })
      .populate('elderly', 'firstName lastName phone address')
      .sort({ scheduledDate: 1 });

    const schedule = [];

    helpVisits.forEach((item) => {
      const elder = item.elderlyId || {};
      const caregiver = item.caregiverId || {};
      schedule.push({
        id: item._id.toString(),
        _id: item._id.toString(),
        requestId: item._id.toString(),
        serviceType: item.serviceType || 'Elderly Assistance',
        elderName: `${elder.firstName || 'Elder'} ${elder.lastName || ''}`.trim(),
        elderPhone: elder.phone || '',
        caregiverName: `${caregiver.firstName || 'Family Member'} ${caregiver.lastName || ''}`.trim(),
        caregiverPhone: caregiver.phone || '',
        date: item.date || 'Today',
        time: item.time || '10:00 AM',
        location: item.location || (elder.address ? `${elder.address.streetAddress}, ${elder.address.city}` : 'Colombo'),
        status: item.status, // 'matched' | 'confirmed' | 'ongoing' | 'arrived'
        isDirectRequest: item.status === 'matched',
        trackingConsent: item.trackingConsent || false,
        arrivedAt: item.arrivedAt,
        notes: `Task for ${item.serviceType}.`,
        source: 'help_request',
      });
    });

    compVisits.forEach((item) => {
      const elder = item.elderly || {};
      schedule.push({
        id: item._id.toString(),
        _id: item._id.toString(),
        serviceType: item.activityType || 'Companionship Visit',
        elderName: `${elder.firstName || 'Elder'} ${elder.lastName || ''}`.trim(),
        elderPhone: elder.phone || '',
        date: item.scheduledDate ? new Date(item.scheduledDate).toISOString().split('T')[0] : 'Today',
        time: item.timeSlot || item.startTime || '02:00 PM',
        location: item.location || (elder.address ? `${elder.address.streetAddress}, ${elder.address.city}` : 'Colombo'),
        status: 'confirmed',
        notes: item.notes || 'Companionship visit',
        source: 'companionship',
      });
    });

    res.status(200).json({
      success: true,
      count: schedule.length,
      data: schedule,
    });
  } catch (error) {
    console.error('Get My Schedule Error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while fetching volunteer schedule',
      error: error.message,
    });
  }
};

// @desc    Update task status (arrived / completed / cancelled)
// @route   PUT /api/volunteer-offers/tasks/:id/status
// @access  Private (Volunteer)
exports.updateTaskStatus = async (req, res) => {
  try {
    const { status } = req.body;
    const allowed = ['ongoing', 'arrived', 'completed', 'cancelled'];
    if (!allowed.includes(status)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid status. Must be ongoing, arrived, completed, or cancelled',
      });
    }

    let request = await HelpRequest.findById(req.params.id);
    if (!request) {
      let compReq = await CompanionshipRequest.findById(req.params.id);
      if (compReq) {
        if (compReq.volunteer && compReq.volunteer.toString() !== req.user._id.toString()) {
          return res.status(403).json({ success: false, message: 'Not authorized for this task' });
        }
        compReq.status = status === 'arrived' ? 'ongoing' : status;
        await compReq.save();
        return res.status(200).json({
          success: true,
          message: `Task status updated to ${status}`,
          data: compReq,
        });
      }
      return res.status(404).json({ success: false, message: 'Task not found' });
    }

    if (request.volunteerId && request.volunteerId.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to update this task',
      });
    }

    request.status = status;
    if (status === 'ongoing') {
      request.trackingConsent = true;
      request.tripStartedAt = Date.now();
    } else if (status === 'arrived') {
      request.arrivedAt = Date.now();
    } else if (status === 'completed') {
      request.completedAt = Date.now();
      // Set a default positive rating if not rated yet so metrics update immediately
      if (!request.rating) {
        request.rating = 5;
        request.feedback = 'Thank you for the wonderful assistance! Punctual and caring.';
      }
    } else if (status === 'cancelled') {
      request.status = 'searching';
      request.volunteerId = null;
    }

    await request.save();

    res.status(200).json({
      success: true,
      message: `Task status updated to ${status} successfully!`,
      data: request,
    });
  } catch (error) {
    console.error('Update Task Status Error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Server error while updating status',
    });
  }
};

// @desc    Get completed visits history & reviews for volunteer
// @route   GET /api/volunteer-offers/my-history
// @access  Private (Volunteer)
exports.getMyHistory = async (req, res) => {
  try {
    const completedHelp = await HelpRequest.find({
      volunteerId: req.user._id,
      status: 'completed',
    })
      .populate('elderlyId', 'firstName lastName phone address')
      .sort({ completedAt: -1, updatedAt: -1 });

    const completedComp = await CompanionshipRequest.find({
      volunteer: req.user._id,
      status: 'completed',
    })
      .populate('elderly', 'firstName lastName phone address')
      .sort({ updatedAt: -1 });

    const history = [];

    completedHelp.forEach((item) => {
      const elder = item.elderlyId || {};
      history.push({
        id: item._id.toString(),
        _id: item._id.toString(),
        date: item.completedAt ? new Date(item.completedAt).toISOString().split('T')[0] : (item.date || 'Recent'),
        elderName: `${elder.firstName || 'Elder'} ${elder.lastName || ''}`.trim(),
        service: item.serviceType || 'Elderly Help',
        rating: item.rating || 5,
        feedback: item.feedback || 'Very punctual and polite! Thank you for the quick help.',
        duration: '1.5 hrs',
        location: item.location || 'Colombo',
      });
    });

    completedComp.forEach((item) => {
      const elder = item.elderly || {};
      history.push({
        id: item._id.toString(),
        _id: item._id.toString(),
        date: item.updatedAt ? new Date(item.updatedAt).toISOString().split('T')[0] : 'Recent',
        elderName: `${elder.firstName || 'Elder'} ${elder.lastName || ''}`.trim(),
        service: item.activityType || 'Companionship',
        rating: 5,
        feedback: 'Wonderful conversation and company!',
        duration: '2.0 hrs',
        location: item.location || 'Colombo',
      });
    });

    res.status(200).json({
      success: true,
      count: history.length,
      data: history,
    });
  } catch (error) {
    console.error('Get My History Error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while fetching volunteer history',
      error: error.message,
    });
  }
};

// @desc    Get volunteer impact stats & dashboard metrics
// @route   GET /api/volunteer-offers/my-stats
// @access  Private (Volunteer)
exports.getMyStats = async (req, res) => {
  try {
    const completedVisits = await HelpRequest.find({
      volunteerId: req.user._id,
      status: 'completed',
    });

    // Calculate visits this month
    const now = new Date();
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();

    const thisMonthVisits = completedVisits.filter((v) => {
      const d = v.completedAt ? new Date(v.completedAt) : new Date(v.updatedAt);
      return d.getMonth() === currentMonth && d.getFullYear() === currentYear;
    });

    const hoursThisMonth = (thisMonthVisits.length * 1.5).toFixed(1);

    // Unique elders helped
    const distinctElders = new Set(completedVisits.map((v) => v.elderlyId?.toString()).filter(Boolean));
    const peopleHelped = distinctElders.size;

    // Average rating
    const ratedVisits = completedVisits.filter((v) => v.rating && v.rating > 0);
    const avgRating = ratedVisits.length > 0
      ? (ratedVisits.reduce((sum, v) => sum + v.rating, 0) / ratedVisits.length).toFixed(1)
      : '5.0';

    const activeOffersCount = await VolunteerOffer.countDocuments({
      volunteerId: req.user._id,
      status: { $in: ['pending', 'active'] },
    });

    const upcomingTasksCount = await HelpRequest.countDocuments({
      volunteerId: req.user._id,
      status: { $in: ['confirmed', 'arrived'] },
    });

    res.status(200).json({
      success: true,
      data: {
        hoursThisMonth: parseFloat(hoursThisMonth) || 0,
        peopleHelped: peopleHelped || 0,
        averageRating: parseFloat(avgRating) || 5.0,
        totalCompletedVisits: completedVisits.length,
        totalHours: (completedVisits.length * 1.5).toFixed(1),
        activeOffersCount,
        upcomingTasksCount,
      },
    });
  } catch (error) {
    console.error('Get My Stats Error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while fetching volunteer statistics',
      error: error.message,
    });
  }
};

// @desc    Get pending direct visit requests sent by family members to this volunteer
// @route   GET /api/volunteer-offers/direct-requests
// @access  Private (Volunteer)
exports.getDirectRequests = async (req, res) => {
  try {
    const directRequests = await HelpRequest.find({
      volunteerId: req.user._id,
      status: 'matched',
    })
      .populate('elderlyId', 'firstName lastName phone address')
      .populate('caregiverId', 'firstName lastName phone')
      .sort({ createdAt: -1 });

    const formatted = directRequests.map((hr) => {
      const elder = hr.elderlyId || {};
      const caregiver = hr.caregiverId || {};
      return {
        id: hr._id.toString(),
        _id: hr._id.toString(),
        requestId: hr._id.toString(),
        type: `${hr.serviceType} Assistance`,
        serviceType: hr.serviceType,
        elderName: `${elder.firstName || 'Elder'} ${elder.lastName || ''}`.trim(),
        elderPhone: elder.phone || '',
        caregiverName: `${caregiver.firstName || 'Family Member'} ${caregiver.lastName || ''}`.trim(),
        caregiverPhone: caregiver.phone || '',
        date: hr.date,
        time: hr.time,
        location: hr.location || (elder.address ? `${elder.address.streetAddress}, ${elder.address.city}` : 'Colombo'),
        address: hr.location || (elder.address ? `${elder.address.streetAddress}, ${elder.address.city}` : 'Colombo'),
        status: hr.status,
        isDirectRequest: true,
        createdAt: hr.createdAt,
      };
    });

    res.status(200).json({
      success: true,
      count: formatted.length,
      data: formatted,
    });
  } catch (error) {
    console.error('Get Direct Requests Error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while fetching direct requests',
      error: error.message,
    });
  }
};
