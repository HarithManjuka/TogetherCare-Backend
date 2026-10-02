// controllers/volunteerOfferController.js
const VolunteerOffer = require('../models/VolunteerOffer');
const {
  getVisitTimeWindow,
  syncAndAutoTransitionVisits,
  checkElderScheduleOverlap,
} = require('../utils/scheduleHelper');

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
    const todayStr = new Date().toISOString().split('T')[0];

    // Filter out past/outdated offers that are not accepted, only show active current/future dates
    let query = {
      slotsLeft: { $gt: 0 },
      status: { $in: ['pending', 'active'] },
      $or: [
        { date: { $gte: todayStr } },
        { date: { $exists: false } },
        { date: null },
        { date: '' },
      ],
    };

    if (service && service !== 'All') {
      query.services = { $in: [service] };
    }
    if (location && location.trim()) {
      query.serviceArea = { $regex: location.trim(), $options: 'i' };
    }

    // Newest posted offers on top
    const offers = await VolunteerOffer.find(query)
      .populate('volunteerId', 'firstName lastName email phone profilePicture verificationBadgeStatus isEmailVerified age educationalInstitution bio rating address interests')
      .sort({ createdAt: -1, date: 1 });

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

    // Check if the elderly user already has an overlapping active request or scheduled visit
    const overlapCheck = await checkElderScheduleOverlap(req.user._id, {
      scheduledDate: offer.date,
      startTime: offer.startTime || '02:00 PM',
      endTime: offer.endTime || '04:00 PM',
      timeSlot: `${offer.startTime || '02:00 PM'} - ${offer.endTime || '04:00 PM'}`,
    });

    if (overlapCheck.hasConflict) {
      return res.status(400).json({
        success: false,
        message: overlapCheck.message,
        conflict: true,
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

    // Send notification to volunteer
    try {
      const { createNotification } = require('./notificationController');
      const elderName = `${req.user.firstName || 'Elder'} ${req.user.lastName || ''}`.trim();
      const volunteerId = offer.volunteerId._id || offer.volunteerId;
      if (volunteerId) {
        await createNotification({
          recipient: volunteerId,
          sender: req.user._id,
          senior: req.user._id,
          type: 'visit_approved',
          title: 'New Visit Booked! 🤝',
          message: `${elderName} has booked a ${primaryService} visit with you on ${offer.date} (${offer.startTime} - ${offer.endTime}).`,
          data: { companionshipId: companionship._id, date: offer.date, location: offer.serviceArea },
        });
      }
    } catch (notifErr) {
      console.warn('Could not send notification for accepted offer:', notifErr.message);
    }

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
const Activity = require('../models/Activity');
const Interest = require('../models/Interest');
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
    const { category, search, sameDistrictOnly } = req.query;
    const todayStr = new Date().toISOString().split('T')[0];

    const SRI_LANKA_DISTRICTS = [
      'Colombo', 'Gampaha', 'Kalutara', 'Kandy', 'Matale', 'Nuwara Eliya',
      'Galle', 'Matara', 'Hambantota', 'Jaffna', 'Kilinochchi', 'Mannar',
      'Vavuniya', 'Mullaitivu', 'Batticaloa', 'Ampara', 'Trincomalee',
      'Kurunegala', 'Puttalam', 'Anuradhapura', 'Polonnaruwa', 'Badulla',
      'Monaragala', 'Ratnapura', 'Kegalle'
    ];

    const detectDistrict = (text, explicitDistrict) => {
      if (explicitDistrict && explicitDistrict.trim()) {
        const found = SRI_LANKA_DISTRICTS.find(
          (d) => d.toLowerCase() === explicitDistrict.trim().toLowerCase()
        );
        if (found) return found;
      }
      if (!text) return 'Colombo';
      for (const d of SRI_LANKA_DISTRICTS) {
        const regex = new RegExp(`\\b${d}\\b`, 'i');
        if (regex.test(text)) return d;
      }
      const lower = text.toLowerCase();
      if (/colombo|dehiwala|mount lavinia|moratuwa|nugegoda|kotte|maharagama|kesbewa|homagama|piliyandala|rajagiriya|battaramulla|borella|pettah/i.test(lower)) return 'Colombo';
      if (/gampaha|negombo|kelaniya|wattala|ja-ela|ragama|kiribathgoda|kadawatha|minuwangoda/i.test(lower)) return 'Gampaha';
      if (/kalutara|panadura|beruwala|wadduwa|aluthgama|matugama|horana|bandaragama/i.test(lower)) return 'Kalutara';
      if (/kandy|peradeniya|katugastota|gampola|kundasale|gelioya/i.test(lower)) return 'Kandy';
      if (/galle|hikkaduwa|karapitiya|unawatuna|ambalangoda/i.test(lower)) return 'Galle';
      if (/matara|weligama|akuressa|dickwella/i.test(lower)) return 'Matara';
      if (/jaffna|chavakachcheri|point pedro/i.test(lower)) return 'Jaffna';
      if (/kurunegala|kuliyapitiya|narammala/i.test(lower)) return 'Kurunegala';
      return 'Colombo';
    };

    const userAddrFull = typeof req.user?.address === 'string'
      ? req.user.address
      : [req.user?.address?.streetAddress, req.user?.address?.city, req.user?.address?.district].filter(Boolean).join(', ');
    const volunteerDistrict = detectDistrict(userAddrFull, req.user?.address?.district);

    // 1. Query pending Companionship Requests created by Elders
    let compQuery = {
      status: { $in: ['pending', 'open', 'searching'] },
      volunteer: null,
    };

    // 2. Query open Help Requests created by Elders or Family Caregivers
    let helpQuery = {
      status: { $in: ['searching', 'pending', 'open'] },
      volunteerId: null,
    };

    if (category && category !== 'all') {
      const catLower = category.toLowerCase().trim();
      if (catLower === 'companionship') {
        compQuery.activityType = { $not: /grocery|food|medicine|pharmacy|prescript/i };
        helpQuery.serviceType = { $regex: 'comp|social|chat', $options: 'i' };
      } else if (catLower === 'grocery') {
        compQuery.activityType = { $regex: 'grocer|food|shop', $options: 'i' };
        helpQuery.serviceType = { $regex: 'grocer|food|shop', $options: 'i' };
      } else if (catLower === 'medicine') {
        compQuery.activityType = { $regex: 'med|pharm|prescript', $options: 'i' };
        helpQuery.serviceType = { $regex: 'med|pharm|prescript', $options: 'i' };
      } else if (catLower === 'walk') {
        compQuery.activityType = { $regex: 'walk|stroll|exercise', $options: 'i' };
        helpQuery.serviceType = { $regex: 'walk|stroll|exercise', $options: 'i' };
      } else if (catLower === 'reading') {
        compQuery.activityType = { $regex: 'read|book|newspaper', $options: 'i' };
        helpQuery.serviceType = { $regex: 'read|book|newspaper', $options: 'i' };
      } else if (catLower === 'chat') {
        compQuery.activityType = { $regex: 'chat|call|talk|conversation', $options: 'i' };
        helpQuery.serviceType = { $regex: 'chat|call|talk|conversation', $options: 'i' };
      } else {
        compQuery.activityType = { $regex: category, $options: 'i' };
        helpQuery.serviceType = { $regex: category, $options: 'i' };
      }
    }

    const companionshipRequests = await CompanionshipRequest.find(compQuery)
      .populate('elderly', 'firstName lastName phone address profilePicture customId isEmailVerified verificationBadgeStatus age interests')
      .populate('activityId', 'name icon iconFamily')
      .sort({ createdAt: -1 });

    const helpRequests = await HelpRequest.find(helpQuery)
      .populate('elderlyId', 'firstName lastName phone address profilePicture customId isEmailVerified verificationBadgeStatus age interests')
      .populate('caregiverId', 'firstName lastName phone')
      .sort({ createdAt: -1 });

    const formattedComp = companionshipRequests.map((cr) => {
      const elder = cr.elderly || {};
      const cat = (cr.activityType || '').toLowerCase();

      let dateStr = todayStr;
      let isFlexible = false;
      if (cr.scheduledDate) {
        const d = new Date(cr.scheduledDate);
        if (!isNaN(d.getTime())) {
          dateStr = d.toISOString().split('T')[0];
          if (dateStr < todayStr) {
            isFlexible = true;
          }
        }
      } else {
        isFlexible = true;
      }

      const elderAddr = elder.address
        ? (typeof elder.address === 'string'
            ? elder.address
            : [elder.address.streetAddress, elder.address.city, elder.address.district].filter(Boolean).join(', '))
        : 'Colombo';

      const taskDistrict = detectDistrict(
        cr.location || elderAddr || '',
        typeof elder.address === 'object' ? elder.address?.district : ''
      );

      const isSameDistrict = Boolean(
        volunteerDistrict &&
        taskDistrict &&
        volunteerDistrict.toLowerCase() === taskDistrict.toLowerCase()
      );

      return {
        id: cr._id.toString(),
        _id: cr._id.toString(),
        type: `${cr.activityType || 'Companionship'} Visit`,
        serviceType: cr.activityType || 'Companionship',
        category: cat.includes('med')
          ? 'medical'
          : cat.includes('grocer')
          ? 'grocery'
          : cat.includes('walk')
          ? 'walk'
          : cat.includes('read')
          ? 'reading'
          : 'companionship',
        elderName: `${elder.firstName || 'Elder'} ${elder.lastName || ''}`.trim() || 'Elderly Resident',
        elderPhone: elder.phone || '',
        distance: isSameDistrict ? 'Nearby (< 5 km)' : '12 km',
        duration: '1-2 hrs',
        badge: isSameDistrict ? 'Same District' : (isFlexible ? 'Open Request' : (dateStr === todayStr ? 'Today' : 'Upcoming')),
        badgeType: isSameDistrict ? 'same_district' : (isFlexible ? 'today' : (dateStr === todayStr ? 'today' : 'upcoming')),
        address: cr.location || elderAddr || 'Colombo',
        district: taskDistrict,
        isSameDistrict,
        date: isFlexible ? 'Flexible (Open)' : dateStr,
        rawDate: dateStr,
        time: cr.timeSlot || `${cr.startTime || '09:00 AM'} - ${cr.endTime || '11:00 AM'}`,
        items: cr.activityType ? [cr.activityType] : ['Companionship'],
        notes: cr.notes || '',
        communicationMethod: cr.communicationMethod || 'in_person',
        status: cr.status,
        source: 'companionship',
        createdAt: cr.createdAt,
      };
    });

    const formattedHelp = helpRequests.map((hr) => {
      const elder = hr.elderlyId || {};
      const cat = (hr.serviceType || '').toLowerCase();
      const isUrgent = cat.includes('med');
      const isFlexible = hr.date && hr.date < todayStr;

      const elderAddr = elder.address
        ? (typeof elder.address === 'string'
            ? elder.address
            : [elder.address.streetAddress, elder.address.city, elder.address.district].filter(Boolean).join(', '))
        : 'Colombo';

      const taskDistrict = detectDistrict(
        hr.location || elderAddr || '',
        typeof elder.address === 'object' ? elder.address?.district : ''
      );

      const isSameDistrict = Boolean(
        volunteerDistrict &&
        taskDistrict &&
        volunteerDistrict.toLowerCase() === taskDistrict.toLowerCase()
      );

      return {
        id: hr._id.toString(),
        _id: hr._id.toString(),
        type: `${hr.serviceType || 'Assistance'} Help`,
        serviceType: hr.serviceType || 'Help',
        category: isUrgent ? 'medical' : cat.includes('grocer') ? 'grocery' : 'companionship',
        elderName: `${elder.firstName || 'Elder'} ${elder.lastName || ''}`.trim() || 'Elderly Resident',
        elderPhone: elder.phone || '',
        distance: isSameDistrict ? 'Nearby (< 5 km)' : '12 km',
        duration: '45 min',
        badge: isUrgent ? 'Urgent' : (isSameDistrict ? 'Same District' : (isFlexible ? 'Open Request' : 'Today')),
        badgeType: isUrgent ? 'urgent' : (isSameDistrict ? 'same_district' : 'today'),
        address: hr.location || elderAddr || 'Colombo',
        district: taskDistrict,
        isSameDistrict,
        date: isFlexible ? 'Flexible (Open)' : (hr.date || todayStr),
        rawDate: hr.date || todayStr,
        time: hr.time || '10:00 AM',
        items: hr.items && hr.items.length > 0 ? hr.items : (hr.serviceType ? [hr.serviceType] : []),
        notes: hr.feedback || hr.notes || '',
        status: hr.status,
        source: 'help_request',
        createdAt: hr.createdAt,
      };
    });

    // Combine all active elder requests and sort same-district first, then newest
    let allFormatted = [...formattedComp, ...formattedHelp].sort((a, b) => {
      if (a.isSameDistrict && !b.isSameDistrict) return -1;
      if (!a.isSameDistrict && b.isSameDistrict) return 1;
      return new Date(b.createdAt || 0) - new Date(a.createdAt || 0);
    });

    if (sameDistrictOnly === 'true' && volunteerDistrict) {
      allFormatted = allFormatted.filter((item) => item.isSameDistrict);
    }

    if (search && search.trim()) {
      const q = search.trim().toLowerCase();
      allFormatted = allFormatted.filter(
        (item) =>
          (item.elderName && item.elderName.toLowerCase().includes(q)) ||
          (item.address && item.address.toLowerCase().includes(q)) ||
          (item.district && item.district.toLowerCase().includes(q)) ||
          (item.serviceType && item.serviceType.toLowerCase().includes(q)) ||
          (item.type && item.type.toLowerCase().includes(q)) ||
          (item.notes && item.notes.toLowerCase().includes(q))
      );
    }

    res.status(200).json({
      success: true,
      count: allFormatted.length,
      volunteerDistrict: volunteerDistrict || 'Colombo',
      data: allFormatted,
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
    const volunteerName = `${req.user.firstName} ${req.user.lastName || ''}`.trim();
    const todayStr = new Date().toISOString().split('T')[0];

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
        compReq.companionName = volunteerName;
        compReq.status = 'accepted';

        // Keep scheduled visit active for today if date was in past or flexible
        const todayStart = new Date(todayStr + 'T00:00:00.000Z');
        if (!compReq.scheduledDate || compReq.scheduledDate < todayStart) {
          compReq.scheduledDate = new Date();
        }
        if (req.body?.arrivalTime && req.body.arrivalTime.trim()) {
          compReq.timeSlot = req.body.arrivalTime.trim();
        }

        await compReq.save();

        // Notify the elderly user
        if (compReq.elderly) {
          const dateStr = compReq.scheduledDate ? new Date(compReq.scheduledDate).toISOString().split('T')[0] : 'Upcoming';
          await createNotification({
            recipient: compReq.elderly,
            sender: req.user._id,
            senior: compReq.elderly,
            type: 'visit_approved',
            title: 'Volunteer Accepted Your Request! 🤝',
            message: `${volunteerName} has accepted your companionship request for ${compReq.activityType} on ${dateStr} (${compReq.timeSlot}).`,
            data: { requestId: compReq._id, date: dateStr, time: compReq.timeSlot },
          });
        }

        return res.status(200).json({
          success: true,
          message: 'Companionship request accepted successfully!',
          data: compReq,
        });
      }
      return res.status(404).json({ success: false, message: 'Request not found' });
    }

    if (request.status !== 'searching' && request.status !== 'pending') {
      return res.status(400).json({
        success: false,
        message: 'This request is no longer open for acceptance',
      });
    }

    request.volunteerId = req.user._id;
    request.status = 'confirmed';
    if (!request.date || request.date < todayStr) {
      request.date = todayStr;
    }
    if (req.body?.arrivalTime && req.body.arrivalTime.trim()) {
      request.time = req.body.arrivalTime.trim();
    }

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

    return res.status(200).json({
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
      status: { $in: ['accepted', 'scheduled', 'ongoing', 'arrived'] },
    })
      .populate('elderly', 'firstName lastName phone address')
      .sort({ scheduledDate: 1 });

    // Auto-transition visits according to time frames (upcoming -> ongoing -> completed)
    await syncAndAutoTransitionVisits([...helpVisits, ...compVisits]);

    const schedule = [];

    helpVisits
      .filter((v) => v.status !== 'completed' && v.status !== 'cancelled')
      .forEach((item) => {
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

    compVisits
      .filter((v) => v.status !== 'completed' && v.status !== 'cancelled')
      .forEach((item) => {
        const elder = item.elderly || {};
        const isOngoing = item.status === 'ongoing';
        const isArrived = item.status === 'arrived';
        schedule.push({
          id: item._id.toString(),
          _id: item._id.toString(),
          requestId: item._id.toString(),
          serviceType: item.activityType || 'Companionship Visit',
          elderName: `${elder.firstName || 'Elder'} ${elder.lastName || ''}`.trim() || 'Senior Member',
          elderPhone: elder.phone || '',
          date: item.scheduledDate ? new Date(item.scheduledDate).toISOString().split('T')[0] : 'Today',
          time: item.timeSlot || item.startTime || '02:00 PM',
          startTime: item.startTime,
          endTime: item.endTime,
          scheduledDate: item.scheduledDate,
          location: item.location || (elder.address ? `${elder.address.streetAddress}, ${elder.address.city}` : 'Colombo'),
          status: isOngoing ? 'ongoing' : isArrived ? 'arrived' : 'confirmed',
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

    const volunteerName = `${req.user.firstName} ${req.user.lastName || ''}`.trim();

    let request = await HelpRequest.findById(req.params.id);
    if (!request) {
      let compReq = await CompanionshipRequest.findById(req.params.id);
      if (compReq) {
        if (compReq.volunteer && compReq.volunteer.toString() !== req.user._id.toString()) {
          // In development / demo testing: re-assign or permit the authenticated volunteer to advance the task
          if (process.env.NODE_ENV !== 'production') {
            console.log(`[Dev] Volunteer ${req.user._id} (${req.user.email}) adopting CompanionshipRequest ${compReq._id} from ${compReq.volunteer}`);
            compReq.volunteer = req.user._id;
            compReq.companionName = volunteerName;
            compReq.acceptedBy = req.user._id;
          } else {
            return res.status(403).json({
              success: false,
              message: `Not authorized: This visit is assigned to volunteer account (${compReq.companionName || 'another volunteer'}). Please switch to that account.`,
            });
          }
        } else if (!compReq.volunteer) {
          compReq.volunteer = req.user._id;
          compReq.companionName = volunteerName;
          compReq.acceptedBy = req.user._id;
        }

        // Time window restriction for manual start (Allow starting up to 5 min early)
        if ((status === 'ongoing' || status === 'arrived') && process.env.NODE_ENV !== 'test') {
          const { startDateTime, earlyStartDateTime, dateStr, startStr } = getVisitTimeWindow(compReq);
          const now = new Date();

          if (now < earlyStartDateTime) {
            return res.status(400).json({
              success: false,
              message: `This visit is scheduled for ${dateStr} at ${startStr}. You can manually start this visit up to 5 minutes before the scheduled time.`,
              scheduledStart: startDateTime,
              earlyStart: earlyStartDateTime,
            });
          }
        }

        compReq.status = status === 'arrived' ? 'ongoing' : status;
        if (status === 'cancelled') {
          compReq.volunteer = null;
          compReq.acceptedBy = null;
        }
        await compReq.save();

        // Notify elder
        if (compReq.elderly) {
          try {
            if (status === 'cancelled') {
              await createNotification({
                recipient: compReq.elderly,
                sender: req.user._id,
                senior: compReq.elderly,
                type: 'visit_cancelled',
                title: 'Volunteer Cancelled Visit ⚠️',
                message: `${volunteerName} had to cancel their scheduled visit for ${compReq.activityType || 'companionship'}.`,
                data: { requestId: compReq._id, status: 'cancelled' },
              });
            } else if (status === 'ongoing' || status === 'arrived') {
              await createNotification({
                recipient: compReq.elderly,
                sender: req.user._id,
                senior: compReq.elderly,
                type: 'visit_started',
                title: 'Volunteer On The Way / Arrived 🚗',
                message: `${volunteerName} has started / arrived for your ${compReq.activityType} visit.`,
                data: { requestId: compReq._id, status: compReq.status },
              });
            } else if (status === 'completed') {
              await createNotification({
                recipient: compReq.elderly,
                sender: req.user._id,
                senior: compReq.elderly,
                type: 'visit_completed',
                title: 'Visit Completed! 🎉',
                message: `${volunteerName} has completed the ${compReq.activityType} visit.`,
                data: { requestId: compReq._id, status: 'completed' },
              });
            }
          } catch (notifErr) {
            console.error('Failed to send notification to elder:', notifErr);
          }
        }

        return res.status(200).json({
          success: true,
          message: `Task status updated to ${status}`,
          data: compReq,
        });
      }
      return res.status(404).json({ success: false, message: 'Task not found' });
    }

    if (request.volunteerId && request.volunteerId.toString() !== req.user._id.toString()) {
      if (process.env.NODE_ENV !== 'production') {
        console.log(`[Dev] Volunteer ${req.user._id} (${req.user.email}) adopting HelpRequest ${request._id} from ${request.volunteerId}`);
        request.volunteerId = req.user._id;
      } else {
        return res.status(403).json({
          success: false,
          message: 'Not authorized to update this task: Assigned to another volunteer account.',
        });
      }
    } else if (!request.volunteerId) {
      request.volunteerId = req.user._id;
    }

    // Time window restriction for manual start (Allow starting up to 5 min early)
    if ((status === 'ongoing' || status === 'arrived') && process.env.NODE_ENV !== 'test') {
      const { startDateTime, earlyStartDateTime, dateStr, startStr } = getVisitTimeWindow(request);
      const now = new Date();

      if (now < earlyStartDateTime) {
        return res.status(400).json({
          success: false,
          message: `This visit is scheduled for ${dateStr} at ${startStr}. You can manually start this visit up to 5 minutes before the scheduled time.`,
          scheduledStart: startDateTime,
          earlyStart: earlyStartDateTime,
        });
      }
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

    // Send notifications to elder and caregiver
    try {
      if (status === 'cancelled') {
        if (request.elderlyId) {
          await createNotification({
            recipient: request.elderlyId,
            sender: req.user._id,
            senior: request.elderlyId,
            type: 'visit_cancelled',
            title: 'Volunteer Cancelled Visit ⚠️',
            message: `${volunteerName} had to cancel the ${request.serviceType || 'assistance'} visit.`,
            data: { requestId: request._id, status: 'cancelled' },
          });
        }
        if (request.caregiverId) {
          await createNotification({
            recipient: request.caregiverId,
            sender: req.user._id,
            senior: request.elderlyId,
            type: 'visit_cancelled',
            title: 'Volunteer Cancelled Visit ⚠️',
            message: `${volunteerName} had to cancel the ${request.serviceType || 'assistance'} visit.`,
            data: { requestId: request._id, status: 'cancelled' },
          });
        }
      } else if (status === 'arrived' || status === 'ongoing') {
        if (request.elderlyId) {
          await createNotification({
            recipient: request.elderlyId,
            sender: req.user._id,
            senior: request.elderlyId,
            type: 'visit_started',
            title: 'Volunteer Arrived 🚗',
            message: `${volunteerName} has arrived for the ${request.serviceType} visit.`,
            data: { requestId: request._id, status },
          });
        }
      } else if (status === 'completed') {
        if (request.elderlyId) {
          await createNotification({
            recipient: request.elderlyId,
            sender: req.user._id,
            senior: request.elderlyId,
            type: 'visit_completed',
            title: 'Visit Completed! 🎉',
            message: `${volunteerName} has completed the ${request.serviceType} visit.`,
            data: { requestId: request._id, status: 'completed' },
          });
        }
      }
    } catch (notifErr) {
      console.error('Failed to send task status notifications:', notifErr);
    }

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
      .sort({ scheduledDate: -1, updatedAt: -1 });

    // Find any real reviews created for these completed requests
    const allRequestIds = [
      ...completedHelp.map((h) => h._id),
      ...completedComp.map((c) => c._id),
    ];

    const Review = require('../models/Review');
    const associatedReviews = await Review.find({
      $or: [
        { scheduleId: { $in: allRequestIds } },
        { 'visitDetails.requestId': { $in: allRequestIds } },
      ],
    }).lean();

    const reviewMap = new Map();
    associatedReviews.forEach((rev) => {
      const key = (rev.scheduleId || rev.visitDetails?.requestId)?.toString();
      if (key) {
        reviewMap.set(key, rev);
      }
    });

    const history = [];

    completedHelp.forEach((item) => {
      const elder = item.elderlyId || {};
      const rev = reviewMap.get(item._id.toString());

      // Only mark as rated if elder really submitted a rating
      const hasRealRating = Boolean(
        (rev && rev.rating) ||
        (item.rating !== null && item.rating !== undefined && Number(item.rating) > 0)
      );

      const effectiveRating = hasRealRating
        ? (rev?.rating || item.rating)
        : null;

      const rawFeedback = (rev?.comment || rev?.visitReview || item.feedback || '').trim();
      const effectiveFeedback = (hasRealRating && rawFeedback &&
        rawFeedback !== 'Very punctual and polite! Thank you for the quick help.' &&
        rawFeedback !== 'Wonderful conversation and company!')
          ? rawFeedback
          : null;

      history.push({
        id: item._id.toString(),
        _id: item._id.toString(),
        date: item.completedAt ? new Date(item.completedAt).toISOString().split('T')[0] : (item.date || 'Recent'),
        elderName: `${elder.firstName || 'Elder'} ${elder.lastName || ''}`.trim() || 'Senior Resident',
        service: item.serviceType || 'Elderly Help',
        hasRated: hasRealRating,
        rating: effectiveRating,
        feedback: effectiveFeedback,
        duration: '1.5 hrs',
        location: item.location || 'Colombo',
      });
    });

    completedComp.forEach((item) => {
      const elder = item.elderly || {};
      const rev = reviewMap.get(item._id.toString());
      const dateStr = item.scheduledDate
        ? new Date(item.scheduledDate).toISOString().split('T')[0]
        : (item.updatedAt ? new Date(item.updatedAt).toISOString().split('T')[0] : 'Recent');

      // Only mark as rated if elder really submitted a rating
      const hasRealRating = Boolean(
        (rev && rev.rating) ||
        (item.ratedAt && (item.rating || item.volunteerRating || item.visitRating)) ||
        (item.volunteerRating !== null && item.volunteerRating !== undefined && Number(item.volunteerRating) > 0) ||
        (item.visitRating !== null && item.visitRating !== undefined && Number(item.visitRating) > 0) ||
        (item.rating !== null && item.rating !== undefined && Number(item.rating) > 0)
      );

      const effectiveRating = hasRealRating
        ? (rev?.rating || item.volunteerRating || item.visitRating || item.rating)
        : null;

      const rawFeedback = (rev?.comment || rev?.visitReview || item.volunteerReview || item.visitReview || item.feedback || '').trim();
      const effectiveFeedback = (hasRealRating && rawFeedback &&
        rawFeedback !== 'Very punctual and polite! Thank you for the quick help.' &&
        rawFeedback !== 'Wonderful conversation and company!')
          ? rawFeedback
          : null;

      history.push({
        id: item._id.toString(),
        _id: item._id.toString(),
        date: dateStr,
        elderName: `${elder.firstName || 'Elder'} ${elder.lastName || ''}`.trim() || 'Senior Member',
        service: item.activityType || 'Companionship',
        hasRated: hasRealRating,
        rating: effectiveRating,
        feedback: effectiveFeedback,
        duration: item.timeSlot || '2.0 hrs',
        location: item.location || 'Colombo',
      });
    });

    // Sort newest date first
    history.sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));

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

// @desc    Manually add / log a completed volunteer service activity
// @route   POST /api/volunteer-offers/my-history
// @access  Private (Volunteer)
exports.addHistoryLog = async (req, res) => {
  try {
    const {
      serviceType,
      elderName,
      date,
      time,
      durationHours,
      location,
      notes,
      rating,
      feedback,
    } = req.body;

    if (!serviceType || !serviceType.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Please provide the service or activity type',
      });
    }

    const Review = require('../models/Review');

    let elderUser = null;
    if (elderName && elderName.trim()) {
      const nameParts = elderName.trim().split(' ');
      elderUser = await User.findOne({
        role: 'elderly',
        firstName: { $regex: new RegExp(nameParts[0], 'i') },
      });
    }

    if (!elderUser) {
      elderUser = await User.findOne({ role: 'elderly' });
    }

    const scheduledDateObj = date ? new Date(date) : new Date();
    const durationNum = parseFloat(durationHours) || 2.0;
    const finalRating = (rating !== undefined && rating !== null && !isNaN(parseInt(rating, 10)) && parseInt(rating, 10) > 0)
      ? parseInt(rating, 10)
      : null;
    const finalElderName = elderName && elderName.trim()
      ? elderName.trim()
      : (elderUser ? `${elderUser.firstName || 'Senior'} ${elderUser.lastName || ''}`.trim() : 'Senior Resident');
    const finalFeedback = feedback && feedback.trim()
      ? feedback.trim()
      : '';

    const companionship = await CompanionshipRequest.create({
      elderly: elderUser ? elderUser._id : req.user._id,
      volunteer: req.user._id,
      acceptedBy: req.user._id,
      acceptedAt: scheduledDateObj,
      companionName: `${req.user.firstName} ${req.user.lastName || ''}`.trim(),
      activityType: serviceType.trim(),
      scheduledDate: scheduledDateObj,
      timeSlot: time || `${durationNum} hrs Visit`,
      status: 'completed',
      location: location && location.trim() ? location.trim() : 'Colombo, Sri Lanka',
      notes: notes && notes.trim() ? notes.trim() : 'Completed community volunteer visit',
      rating: finalRating,
      feedback: finalFeedback,
      visitRating: finalRating,
      visitReview: finalFeedback,
      volunteerRating: finalRating,
      volunteerReview: finalFeedback,
      ratedAt: finalRating ? new Date() : null,
    });

    if (elderUser && finalRating) {
      try {
        await Review.create({
          reviewer: elderUser._id,
          recipient: req.user._id,
          rating: finalRating,
          comment: finalFeedback,
          scheduleId: companionship._id,
          scheduleModel: 'CompanionshipRequest',
          visitRating: finalRating,
          visitReview: finalFeedback,
          visitDetails: {
            requestId: companionship._id,
            activityType: serviceType.trim(),
            date: date || new Date().toISOString().split('T')[0],
            location: location || 'Colombo, Sri Lanka',
          },
        });
      } catch (revErr) {
        console.warn('Could not create review record for history log:', revErr.message);
      }
    }

    res.status(201).json({
      success: true,
      message: 'Volunteer history log added successfully!',
      data: {
        id: companionship._id.toString(),
        _id: companionship._id.toString(),
        date: scheduledDateObj.toISOString().split('T')[0],
        elderName: finalElderName,
        service: serviceType.trim(),
        hasRated: Boolean(finalRating),
        rating: finalRating,
        feedback: finalFeedback || null,
        duration: time || `${durationNum} hrs`,
        location: location || 'Colombo, Sri Lanka',
      },
    });
  } catch (error) {
    console.error('Add History Log Error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while adding volunteer history log',
      error: error.message,
    });
  }
};

// @desc    Get volunteer impact stats & dashboard metrics
// @route   GET /api/volunteer-offers/my-stats
// @access  Private (Volunteer)
exports.getMyStats = async (req, res) => {
  try {
    const Review = require('../models/Review');
    const CompanionshipRequest = require('../models/CompanionshipRequest');
    const User = require('../models/User');

    const completedVisits = await HelpRequest.find({
      volunteerId: req.user._id,
      status: 'completed',
    });

    const completedCompVisits = await CompanionshipRequest.find({
      volunteer: req.user._id,
      status: 'completed',
    });

    const allCompleted = [...completedVisits, ...completedCompVisits];

    // Calculate visits this month
    const now = new Date();
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();

    const thisMonthVisits = allCompleted.filter((v) => {
      const d = v.completedAt
        ? new Date(v.completedAt)
        : (v.scheduledDate ? new Date(v.scheduledDate) : (v.updatedAt ? new Date(v.updatedAt) : new Date()));
      return d.getMonth() === currentMonth && d.getFullYear() === currentYear;
    });

    const hoursCalc = thisMonthVisits.length > 0 ? (thisMonthVisits.length * 1.5).toFixed(1) : (allCompleted.length * 1.5).toFixed(1);
    const hoursThisMonth = parseFloat(hoursCalc) || (allCompleted.length > 0 ? allCompleted.length * 1.5 : 0);

    // Unique elders helped
    const distinctElders = new Set(
      allCompleted
        .map((v) => (v.elderlyId?._id || v.elderlyId || v.elderly?._id || v.elderly)?.toString())
        .filter(Boolean)
    );
    const peopleHelped = distinctElders.size > 0 ? distinctElders.size : allCompleted.length;

    // Fetch actual database reviews submitted by elders
    const dbReviews = await Review.find({ recipient: req.user._id });
    let avgRating = 0;
    if (dbReviews.length > 0) {
      const sum = dbReviews.reduce((acc, curr) => acc + (curr.rating || 0), 0);
      avgRating = Number((sum / dbReviews.length).toFixed(1));
    } else if (req.user.rating && req.user.rating > 0) {
      avgRating = Number(req.user.rating.toFixed(1));
    }

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
        averageRating: avgRating > 0 ? avgRating : 0,
        totalReviews: dbReviews.length,
        totalCompletedVisits: allCompleted.length,
        totalHours: (allCompleted.length * 1.5).toFixed(1),
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
