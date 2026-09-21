// controllers/helpRequestController.js
const HelpRequest = require('../models/HelpRequest');
const VolunteerOffer = require('../models/VolunteerOffer');
const CompanionshipRequest = require('../models/CompanionshipRequest');
const User = require('../models/User');
const { createNotification } = require('./notificationController');

// Helper to calculate rating for a volunteer
const getVolunteerDetails = async (volunteerId) => {
  const volunteer = await User.findById(volunteerId).select('-password');
  if (!volunteer) return null;

  // Calculate average rating
  const requests = await HelpRequest.find({ volunteerId, status: 'completed', rating: { $ne: null } });
  const count = requests.length;
  const avgRating = count > 0 ? (requests.reduce((sum, r) => sum + r.rating, 0) / count).toFixed(1) : '5.0';

  // Get reviews
  const reviews = requests
    .filter(r => r.feedback)
    .map(r => ({
      rating: r.rating,
      feedback: r.feedback,
      date: r.completedAt,
    }))
    .slice(0, 3); // top 3 reviews

  return {
    profile: volunteer,
    averageRating: parseFloat(avgRating),
    ratingCount: count,
    reviews,
  };
};

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

const getMatchingVolunteers = async (serviceType, date, location, rejectedVolunteers = []) => {
  const serviceAliases = getServiceAliases(serviceType);
  const rejectedStrings = (rejectedVolunteers || []).map(id => id.toString());
  const loc = (location || '').toLowerCase().trim();

  // 1. Search for VolunteerOffers matching service aliases and date
  let offers = await VolunteerOffer.find({
    services: { $in: serviceAliases },
    date,
    slotsLeft: { $gt: 0 },
    status: { $in: ['pending', 'active'] },
  });

  // Filter out rejected volunteers from offers
  if (rejectedStrings.length > 0) {
    offers = offers.filter(offer => !rejectedStrings.includes(offer.volunteerId.toString()));
  }

  // 2. Fetch all registered volunteers (active or pending verification, not banned)
  let volQuery = {
    role: 'volunteer',
    accountStatus: { $in: ['active', 'pending_verification'] },
    isBanned: { $ne: true },
  };
  if (rejectedStrings.length > 0) {
    volQuery._id = { $nin: rejectedVolunteers };
  }
  const allVolunteers = await User.find(volQuery).select('-password');

  // Map to store matched results by volunteerId
  const matchesMap = new Map();

  // Helper to calculate location score (higher is better)
  const calcLocationScore = (areaStr) => {
    if (!loc || !areaStr) return 0;
    const cleanArea = areaStr.toLowerCase().trim();
    if (loc === cleanArea) return 3; // exact match
    if (loc.includes(cleanArea) || cleanArea.includes(loc)) return 2; // substring match
    // Check word-by-word (e.g. city or district match)
    const locWords = loc.split(/[\s,]+/).filter(w => w.length > 2);
    const areaWords = cleanArea.split(/[\s,]+/).filter(w => w.length > 2);
    const hasCommonWord = locWords.some(lw => areaWords.some(aw => aw === lw || aw.includes(lw) || lw.includes(aw)));
    if (hasCommonWord) return 1;
    return 0;
  };

  // Add volunteers who have posted matching offers first
  for (let offer of offers) {
    const volIdStr = offer.volunteerId.toString();
    if (matchesMap.has(volIdStr)) continue;

    const details = await getVolunteerDetails(offer.volunteerId);
    if (details) {
      const locScore = calcLocationScore(offer.serviceArea || details.profile?.address?.city);
      matchesMap.set(volIdStr, {
        volunteer: details,
        offerId: offer._id,
        hasOffer: true,
        score: 10 + locScore,
      });
    }
  }

  // Add all other registered volunteers
  for (let vol of allVolunteers) {
    const volIdStr = vol._id.toString();
    if (matchesMap.has(volIdStr)) continue;

    const details = await getVolunteerDetails(vol._id);
    if (details) {
      const volCity = vol.address?.city || '';
      const volDistrict = vol.address?.district || '';
      const locScore = Math.max(calcLocationScore(volCity), calcLocationScore(volDistrict));
      matchesMap.set(volIdStr, {
        volunteer: details,
        offerId: null,
        hasOffer: false,
        score: locScore,
      });
    }
  }

  // Sort: highest score first, then by rating, then by review count
  const sortedMatches = Array.from(matchesMap.values()).sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (b.volunteer.averageRating !== a.volunteer.averageRating) {
      return b.volunteer.averageRating - a.volunteer.averageRating;
    }
    return (b.volunteer.ratingCount || 0) - (a.volunteer.ratingCount || 0);
  });

  return sortedMatches.map(({ volunteer, offerId }) => ({
    volunteer,
    offerId,
  }));
};

// @desc    Create a new help request and run match search
// @route   POST /api/help-requests
// @access  Private (Caregiver)
exports.createHelpRequest = async (req, res) => {
  try {
    const { elderlyId, serviceType, date, time, location } = req.body;

    if (!elderlyId || !serviceType || !date || !time || !location) {
      return res.status(400).json({
        success: false,
        message: 'Please fill in all request details',
      });
    }

    // Verify dependent is linked
    const dependent = await User.findById(elderlyId);
    if (!dependent || dependent.linkedCaregiverId?.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Unauthorized dependent selection',
      });
    }

    // 1. Search for matching volunteer offers (will auto-mock if empty)
    const matches = await getMatchingVolunteers(serviceType, date, location, []);

    // 2. Matching and Auto-Approval Logic
    let autoApproved = false;
    let requestStatus = 'searching';
    let chosenVolunteerId = null;
    let chosenOfferId = null;

    for (let match of matches) {
      // Check if caregiver has previously rated this volunteer 4 or 5 stars
      const previousTrustedRequest = await HelpRequest.findOne({
        caregiverId: req.user._id,
        volunteerId: match.volunteer.profile._id,
        status: 'completed',
        rating: { $gte: 4 },
      });

      if (previousTrustedRequest) {
        chosenVolunteerId = match.volunteer.profile._id;
        chosenOfferId = match.offerId;
        autoApproved = true;
        requestStatus = 'confirmed';
        break;
      }
    }

    // 3. Create Help Request record
    const helpRequest = await HelpRequest.create({
      caregiverId: req.user._id,
      elderlyId,
      serviceType,
      date,
      time,
      location,
      status: requestStatus,
      volunteerId: chosenVolunteerId,
      volunteerOfferId: chosenOfferId,
      autoApproved,
    });

    // 4. If auto-approved, immediately decrement the volunteer offer slots
    if (autoApproved && chosenOfferId) {
      const offer = await VolunteerOffer.findById(chosenOfferId);
      if (offer) {
        offer.slotsLeft = Math.max(0, offer.slotsLeft - 1);
        offer.status = offer.slotsLeft === 0 ? 'booked' : 'active';
        await offer.save();
      }
    }

    let volunteerDetails = null;
    if (chosenVolunteerId) {
      volunteerDetails = await getVolunteerDetails(chosenVolunteerId);
    }

    res.status(201).json({
      success: true,
      message: autoApproved
        ? 'Volunteer auto-approved based on your previous high rating!'
        : 'Nearby matching volunteers retrieved.',
      data: helpRequest,
      volunteer: volunteerDetails,
      matches: autoApproved ? [] : matches,
    });
  } catch (error) {
    console.error('Create Request Error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Server error while submitting help request',
    });
  }
};

// @desc    Get all requests for logged-in caregiver
// @route   GET /api/help-requests
// @access  Private (Caregiver)
exports.getHelpRequests = async (req, res) => {
  try {
    const requests = await HelpRequest.find({ caregiverId: req.user._id })
      .populate('elderlyId', 'firstName lastName dateOfBirth phone address')
      .populate('volunteerId', 'firstName lastName phone verificationBadgeStatus')
      .sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      count: requests.length,
      data: requests,
    });
  } catch (error) {
    console.error('Get Requests Error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while fetching requests',
    });
  }
};

// @desc    Get details and volunteer profile for a single request
// @route   GET /api/help-requests/:id
// @access  Private (Caregiver)
exports.getRequestDetails = async (req, res) => {
  try {
    const request = await HelpRequest.findById(req.params.id)
      .populate('elderlyId', 'firstName lastName phone address')
      .populate('volunteerId', 'firstName lastName phone verificationBadgeStatus');

    if (!request) {
      return res.status(404).json({ success: false, message: 'Request not found' });
    }

    if (request.caregiverId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ success: false, message: 'Not authorized' });
    }

    let volunteerDetails = null;
    let matches = [];

    if (request.volunteerId) {
      volunteerDetails = await getVolunteerDetails(request.volunteerId._id);
    }

    if (request.status === 'searching' || request.status === 'matched') {
      matches = await getMatchingVolunteers(
        request.serviceType,
        request.date,
        request.location,
        request.rejectedVolunteers || []
      );
    }

    res.status(200).json({
      success: true,
      data: request,
      volunteer: volunteerDetails,
      matches,
    });
  } catch (error) {
    console.error('Get Request Details Error:', error);
    res.status(500).json({ success: false, message: 'Server error fetching request details' });
  }
};

// @desc    Approve/Request matched volunteer (Caregiver requests volunteer)
// @route   POST /api/help-requests/:id/approve
// @access  Private (Caregiver)
exports.approveMatch = async (req, res) => {
  try {
    const { volunteerId } = req.body;
    const request = await HelpRequest.findById(req.params.id);

    if (!request) {
      return res.status(404).json({ success: false, message: 'Request not found' });
    }

    if (request.caregiverId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ success: false, message: 'Not authorized' });
    }

    if (request.status !== 'searching' && request.status !== 'matched') {
      return res.status(400).json({ success: false, message: 'Request cannot be modified in current state' });
    }

    const resolvedVolunteerId = volunteerId || request.volunteerId;
    if (!resolvedVolunteerId) {
      return res.status(400).json({ success: false, message: 'Please specify volunteer ID to request' });
    }

    // Verify volunteer exists and is valid
    const volunteerUser = await User.findById(resolvedVolunteerId);
    if (!volunteerUser || volunteerUser.role !== 'volunteer') {
      return res.status(404).json({ success: false, message: 'Volunteer profile not found' });
    }

    const serviceAliases = getServiceAliases(request.serviceType);
    const offer = await VolunteerOffer.findOne({
      volunteerId: resolvedVolunteerId,
      date: request.date,
      services: { $in: serviceAliases },
      slotsLeft: { $gt: 0 },
      status: { $in: ['pending', 'active'] },
    });

    request.volunteerId = resolvedVolunteerId;
    request.volunteerOfferId = offer ? offer._id : null;

    // Set to 'matched' (pending volunteer acceptance)
    request.status = 'matched';
    request.autoApproved = false;
    await request.save();

    // Send notifications to volunteer
    const caregiverName = `${req.user.firstName} ${req.user.lastName || ''}`.trim();
    const dependent = await User.findById(request.elderlyId);
    const seniorName = dependent ? `${dependent.firstName} ${dependent.lastName || ''}`.trim() : 'a senior';

    await createNotification({
      recipient: resolvedVolunteerId,
      sender: req.user._id,
      senior: request.elderlyId,
      type: 'visit_requested',
      title: 'New Visit Request! 🤝',
      message: `${caregiverName} has requested you for a ${request.serviceType} visit for ${seniorName} on ${request.date} at ${request.time}. Please review and respond in your schedule.`,
      data: { requestId: request._id, date: request.date, time: request.time },
    });

    res.status(200).json({
      success: true,
      message: 'Visit request sent to volunteer! Awaiting volunteer acceptance.',
      data: request,
    });
  } catch (error) {
    console.error('Approve Match Error:', error);
    res.status(500).json({ success: false, message: error.message || 'Server error while sending request' });
  }
};

// @desc    Volunteer accepts a visit request
// @route   POST /api/help-requests/:id/volunteer-accept
// @access  Private (Volunteer)
exports.volunteerAccept = async (req, res) => {
  try {
    const request = await HelpRequest.findById(req.params.id)
      .populate('caregiverId', 'firstName lastName phone')
      .populate('elderlyId', 'firstName lastName phone address');

    if (!request) {
      return res.status(404).json({ success: false, message: 'Request not found' });
    }

    if (!request.volunteerId || request.volunteerId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ success: false, message: 'Not authorized for this request' });
    }

    if (request.status !== 'matched') {
      return res.status(400).json({ success: false, message: 'Request is not in pending acceptance state' });
    }

    request.status = 'confirmed';

    // If matching offer exists, decrement slots
    if (request.volunteerOfferId) {
      const offer = await VolunteerOffer.findById(request.volunteerOfferId);
      if (offer) {
        offer.slotsLeft = Math.max(0, offer.slotsLeft - 1);
        offer.status = offer.slotsLeft === 0 ? 'booked' : 'active';
        await offer.save();
      }
    }

    await request.save();

    const volunteerName = `${req.user.firstName} ${req.user.lastName || ''}`.trim();
    const senior = request.elderlyId;
    const seniorName = senior ? `${senior.firstName} ${senior.lastName || ''}`.trim() : 'a senior';

    // Notify caregiver
    if (request.caregiverId) {
      await createNotification({
        recipient: request.caregiverId._id,
        sender: req.user._id,
        senior: request.elderlyId?._id,
        type: 'visit_approved',
        title: 'Volunteer Accepted Request! 🎉',
        message: `${volunteerName} accepted your ${request.serviceType} visit request for ${seniorName} on ${request.date} at ${request.time}.`,
        data: { requestId: request._id, date: request.date, time: request.time },
      });
    }

    // Notify senior
    if (request.elderlyId) {
      await createNotification({
        recipient: request.elderlyId._id,
        sender: req.user._id,
        senior: request.elderlyId._id,
        type: 'visit_approved',
        title: 'Volunteer Visit Confirmed 🤝',
        message: `${volunteerName} has been confirmed for your ${request.serviceType} visit on ${request.date} at ${request.time}.`,
        data: { requestId: request._id, date: request.date, time: request.time },
      });
    }

    res.status(200).json({
      success: true,
      message: 'You have accepted this visit request! It is now confirmed.',
      data: request,
    });
  } catch (error) {
    console.error('Volunteer Accept Error:', error);
    res.status(500).json({ success: false, message: error.message || 'Server error while accepting request' });
  }
};

// @desc    Volunteer declines a visit request
// @route   POST /api/help-requests/:id/volunteer-decline
// @access  Private (Volunteer)
exports.volunteerDecline = async (req, res) => {
  try {
    const request = await HelpRequest.findById(req.params.id);

    if (!request) {
      return res.status(404).json({ success: false, message: 'Request not found' });
    }

    if (!request.volunteerId || request.volunteerId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ success: false, message: 'Not authorized for this request' });
    }

    if (request.status !== 'matched') {
      return res.status(400).json({ success: false, message: 'Request is not in pending acceptance state' });
    }

    // Revert to searching, add volunteer to rejected list
    request.volunteerId = null;
    request.volunteerOfferId = null;
    request.status = 'searching';
    if (!request.rejectedVolunteers.includes(req.user._id)) {
      request.rejectedVolunteers.push(req.user._id);
    }
    await request.save();

    const volunteerName = `${req.user.firstName} ${req.user.lastName || ''}`.trim();

    // Notify caregiver
    if (request.caregiverId) {
      await createNotification({
        recipient: request.caregiverId,
        sender: req.user._id,
        senior: request.elderlyId,
        type: 'visit_declined',
        title: 'Volunteer Was Unavailable ℹ️',
        message: `${volunteerName} was unable to accept your ${request.serviceType} visit request. Please select another available volunteer.`,
        data: { requestId: request._id, date: request.date, time: request.time },
      });
    }

    res.status(200).json({
      success: true,
      message: 'You have declined this visit request.',
      data: request,
    });
  } catch (error) {
    console.error('Volunteer Decline Error:', error);
    res.status(500).json({ success: false, message: error.message || 'Server error while declining request' });
  }
};

// @desc    Volunteer agrees to share location and starts trip
// @route   POST /api/help-requests/:id/start-trip
// @access  Private (Volunteer)
exports.startTrip = async (req, res) => {
  try {
    const { lat, lng, address } = req.body;
    const request = await HelpRequest.findById(req.params.id);

    if (!request) {
      return res.status(404).json({ success: false, message: 'Request not found' });
    }

    if (!request.volunteerId || request.volunteerId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ success: false, message: 'Not authorized for this request' });
    }

    if (request.status !== 'confirmed' && request.status !== 'ongoing') {
      return res.status(400).json({ success: false, message: 'Request must be confirmed before starting trip' });
    }

    request.status = 'ongoing';
    request.trackingConsent = true;
    request.tripStartedAt = new Date();

    const volUser = await User.findById(req.user._id);
    const resolvedAddress = address || (volUser.address ? `${volUser.address.streetAddress}, ${volUser.address.city}` : '');

    request.volunteerLocation = {
      lat: lat !== undefined ? lat : (volUser.address?.city === 'Colombo' ? 6.9271 : 6.5854),
      lng: lng !== undefined ? lng : (volUser.address?.city === 'Colombo' ? 79.8612 : 79.9607),
      address: resolvedAddress,
      updatedAt: new Date(),
    };

    await request.save();

    const volunteerName = `${req.user.firstName} ${req.user.lastName || ''}`.trim();

    // Notify caregiver
    if (request.caregiverId) {
      await createNotification({
        recipient: request.caregiverId,
        sender: req.user._id,
        senior: request.elderlyId,
        type: 'trip_started',
        title: 'Volunteer On The Way! 📍',
        message: `${volunteerName} has started their trip and is sharing live arrival directions.`,
        data: { requestId: request._id, date: request.date, time: request.time },
      });
    }

    res.status(200).json({
      success: true,
      message: 'Trip started! Live location sharing is now active with the family member.',
      data: request,
    });
  } catch (error) {
    console.error('Start Trip Error:', error);
    res.status(500).json({ success: false, message: error.message || 'Server error while starting trip' });
  }
};

// @desc    Update volunteer live location
// @route   PUT /api/help-requests/:id/location
// @access  Private (Volunteer)
exports.updateLocation = async (req, res) => {
  try {
    const { lat, lng, address } = req.body;
    const request = await HelpRequest.findById(req.params.id);

    if (!request) {
      return res.status(404).json({ success: false, message: 'Request not found' });
    }

    if (!request.volunteerId || request.volunteerId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ success: false, message: 'Not authorized for this request' });
    }

    request.volunteerLocation = {
      lat: lat !== undefined ? lat : request.volunteerLocation?.lat,
      lng: lng !== undefined ? lng : request.volunteerLocation?.lng,
      address: address || request.volunteerLocation?.address || '',
      updatedAt: new Date(),
    };

    await request.save();

    res.status(200).json({
      success: true,
      data: request.volunteerLocation,
    });
  } catch (error) {
    console.error('Update Location Error:', error);
    res.status(500).json({ success: false, message: error.message || 'Server error updating location' });
  }
};

// @desc    Reject matched volunteer & find alternative
// @route   POST /api/help-requests/:id/reject
// @access  Private (Caregiver)
exports.rejectMatch = async (req, res) => {
  try {
    const request = await HelpRequest.findById(req.params.id);

    if (!request) {
      return res.status(404).json({ success: false, message: 'Request not found' });
    }

    if (request.caregiverId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ success: false, message: 'Not authorized' });
    }

    // Add currently matched volunteer to rejected list to avoid re-matching
    const declinedVolunteerId = request.volunteerId;
    if (declinedVolunteerId && !request.rejectedVolunteers.includes(declinedVolunteerId)) {
      request.rejectedVolunteers.push(declinedVolunteerId);
    }

    // Set request back to searching and clear current volunteer assignment
    request.volunteerId = null;
    request.volunteerOfferId = null;
    request.status = 'searching';
    request.autoApproved = false;
    await request.save();

    res.status(200).json({
      success: true,
      message: 'Volunteer declined. Returning to selection list.',
      data: request,
    });
  } catch (error) {
    console.error('Reject Match Error:', error);
    res.status(500).json({ success: false, message: 'Server error while declining volunteer' });
  }
};

// @desc    Trigger emergency SOS
// @route   POST /api/help-requests/:id/sos
// @access  Private (Caregiver)
exports.triggerSOS = async (req, res) => {
  try {
    const request = await HelpRequest.findById(req.params.id);

    if (!request) {
      return res.status(404).json({ success: false, message: 'Request not found' });
    }

    request.sosTriggered = true;
    request.sosTriggeredAt = Date.now();
    await request.save();

    res.status(200).json({
      success: true,
      message: '🚨 Emergency SOS Triggered. Help is on the way!',
      data: request,
    });
  } catch (error) {
    console.error('SOS Trigger Error:', error);
    res.status(500).json({ success: false, message: 'Server error while triggering SOS' });
  }
};

// @desc    Submit rating and review feedback
// @route   POST /api/help-requests/:id/feedback
// @access  Private (Caregiver)
exports.submitFeedback = async (req, res) => {
  try {
    const { rating, feedback } = req.body;

    if (!rating || rating < 1 || rating > 5) {
      return res.status(400).json({ success: false, message: 'Rating must be between 1 and 5 stars' });
    }

    const request = await HelpRequest.findById(req.params.id);

    if (!request) {
      return res.status(404).json({ success: false, message: 'Request not found' });
    }

    if (request.caregiverId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ success: false, message: 'Not authorized' });
    }

    request.rating = rating;
    request.feedback = feedback || '';
    await request.save();

    res.status(200).json({
      success: true,
      message: 'Feedback submitted successfully. Thank you!',
      data: request,
    });
  } catch (error) {
    console.error('Feedback Submit Error:', error);
    res.status(500).json({ success: false, message: 'Server error submitting feedback' });
  }
};

// @desc    Simulate volunteer state updates (Debug Tool)
// @route   POST /api/help-requests/:id/simulate-status
// @access  Private (Caregiver)
exports.simulateStatus = async (req, res) => {
  try {
    const { status } = req.body;
    const allowedStatuses = ['arrived', 'completed'];

    if (!allowedStatuses.includes(status)) {
      return res.status(400).json({ success: false, message: 'Invalid simulation status' });
    }

    const request = await HelpRequest.findById(req.params.id);
    if (!request) {
      return res.status(404).json({ success: false, message: 'Request not found' });
    }

    request.status = status;
    if (status === 'arrived') {
      request.arrivedAt = Date.now();
    } else if (status === 'completed') {
      request.completedAt = Date.now();
    }

    await request.save();

    res.status(200).json({
      success: true,
      message: `Request status simulated to '${status}' successfully.`,
      data: request,
    });
  } catch (error) {
    console.error('Simulate Status Error:', error);
    res.status(500).json({ success: false, message: 'Server error during simulation' });
  }
};

// Helper to convert time strings like "10:00 AM", "02:30 PM" to minutes of the day
const parseTimeToMinutes = (timeStr) => {
  if (!timeStr) return 0;
  const match = timeStr.match(/(\d+):(\d+)\s*(AM|PM)?/i);
  if (!match) return 0;
  let hours = parseInt(match[1], 10);
  const minutes = parseInt(match[2], 10);
  const meridian = (match[3] || '').toUpperCase();
  if (meridian === 'PM' && hours < 12) hours += 12;
  if (meridian === 'AM' && hours === 12) hours = 0;
  return hours * 60 + minutes;
};

// @desc    Get available care assignments for caregivers (Sprint 3)
// @route   GET /api/help-requests/caregiver/assignments
// @access  Private (Caregiver)
exports.getAvailableAssignments = async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    const userDistrict = user?.address?.district;

    // 1. Available HelpRequests
    const helpRequests = await HelpRequest.find({
      status: 'searching',
      caregiverId: { $ne: req.user._id }, // Don't list requests created by this user
    })
      .populate('elderlyId', 'firstName lastName customId phone address')
      .populate('caregiverId', 'firstName lastName phone customId')
      .sort({ createdAt: -1 });

    // 2. Available CompanionshipRequests
    const companionshipRequests = await CompanionshipRequest.find({
      status: 'pending',
      elderly: { $ne: req.user._id },
    })
      .populate('elderly', 'firstName lastName customId phone address')
      .populate('activityId', 'name icon iconFamily')
      .sort({ createdAt: -1 });

    // Format into unified assignments
    const assignments = [
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
        familyContact: hr.caregiverId,
        createdAt: hr.createdAt,
      })),
      ...companionshipRequests.map((cr) => ({
        id: cr._id,
        _id: cr._id,
        type: 'companionship',
        serviceType: cr.activityType || 'Companionship',
        date: cr.scheduledDate ? new Date(cr.scheduledDate).toISOString().split('T')[0] : '',
        time: cr.startTime || cr.timeSlot || '02:00 PM',
        location: cr.location || cr.elderly?.address?.streetAddress || '',
        status: cr.status,
        senior: cr.elderly,
        activity: cr.activityId,
        createdAt: cr.createdAt,
      })),
    ];

    res.status(200).json({
      success: true,
      count: assignments.length,
      data: assignments,
    });
  } catch (error) {
    console.error('Get Available Assignments Error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while fetching available assignments',
      error: error.message,
    });
  }
};

// @desc    Accept care assignment with Schedule Conflict Prevention (US-402)
// @route   POST /api/help-requests/caregiver/assignments/:id/accept
// @access  Private (Caregiver)
exports.acceptCaregiverAssignment = async (req, res) => {
  try {
    const assignmentId = req.params.id;
    const { assignmentType } = req.body; // 'help_request' or 'companionship'
    const caregiverId = req.user._id;

    let targetDate = '';
    let targetTime = '';
    let targetSenior = null;
    let targetFamilyMember = null;
    let assignmentDoc = null;

    if (assignmentType === 'companionship') {
      assignmentDoc = await CompanionshipRequest.findById(assignmentId).populate('elderly');
      if (!assignmentDoc) {
        return res.status(404).json({ success: false, message: 'Companionship request not found' });
      }
      if (assignmentDoc.status !== 'pending') {
        return res.status(400).json({ success: false, message: 'This assignment is no longer available' });
      }
      targetDate = assignmentDoc.scheduledDate ? new Date(assignmentDoc.scheduledDate).toISOString().split('T')[0] : '';
      targetTime = assignmentDoc.startTime || assignmentDoc.timeSlot || '02:00 PM';
      targetSenior = assignmentDoc.elderly;
      targetFamilyMember = assignmentDoc.elderly?.linkedCaregiverId;
    } else {
      // Default to help_request
      assignmentDoc = await HelpRequest.findById(assignmentId).populate('elderlyId');
      if (!assignmentDoc) {
        return res.status(404).json({ success: false, message: 'Help request not found' });
      }
      if (assignmentDoc.status !== 'searching' && assignmentDoc.status !== 'matched') {
        return res.status(400).json({ success: false, message: 'This assignment is no longer available' });
      }
      targetDate = assignmentDoc.date;
      targetTime = assignmentDoc.time;
      targetSenior = assignmentDoc.elderlyId;
      targetFamilyMember = assignmentDoc.caregiverId;
    }

    const proposedMinutes = parseTimeToMinutes(targetTime);

    // US-402: Check for caregiver schedule conflicts on the same date
    // Check existing HelpRequests
    const existingHelpRequests = await HelpRequest.find({
      volunteerId: caregiverId,
      date: targetDate,
      status: { $in: ['confirmed', 'arrived'] },
    }).populate('elderlyId', 'firstName lastName');

    for (const hr of existingHelpRequests) {
      const existingMinutes = parseTimeToMinutes(hr.time);
      // Conflict if visits are within 90 minutes of each other
      if (Math.abs(existingMinutes - proposedMinutes) < 90) {
        return res.status(409).json({
          success: false,
          conflict: true,
          message: `Schedule conflict detected! You already have an active visit for ${hr.elderlyId?.firstName || 'a senior'} at ${hr.time} on ${targetDate}.`,
          conflictingVisit: {
            id: hr._id,
            type: 'help_request',
            serviceType: hr.serviceType,
            date: hr.date,
            time: hr.time,
            senior: hr.elderlyId,
          },
        });
      }
    }

    // Check existing CompanionshipRequests
    const existingCompanionship = await CompanionshipRequest.find({
      volunteer: caregiverId,
      status: { $in: ['accepted', 'ongoing'] },
    }).populate('elderly', 'firstName lastName');

    for (const cr of existingCompanionship) {
      const crDate = cr.scheduledDate ? new Date(cr.scheduledDate).toISOString().split('T')[0] : '';
      if (crDate === targetDate) {
        const existingMinutes = parseTimeToMinutes(cr.startTime || cr.timeSlot);
        if (Math.abs(existingMinutes - proposedMinutes) < 90) {
          return res.status(409).json({
            success: false,
            conflict: true,
            message: `Schedule conflict detected! You already have an accepted companionship session for ${cr.elderly?.firstName || 'a senior'} at ${cr.startTime || cr.timeSlot} on ${targetDate}.`,
            conflictingVisit: {
              id: cr._id,
              type: 'companionship',
              serviceType: cr.activityType,
              date: crDate,
              time: cr.startTime || cr.timeSlot,
              senior: cr.elderly,
            },
          });
        }
      }
    }

    // No conflict: Assign caregiver
    if (assignmentType === 'companionship') {
      assignmentDoc.volunteer = caregiverId;
      assignmentDoc.acceptedBy = caregiverId;
      assignmentDoc.acceptedAt = new Date();
      assignmentDoc.companionName = `${req.user.firstName} ${req.user.lastName || ''}`.trim();
      assignmentDoc.status = 'accepted';
      await assignmentDoc.save();
    } else {
      assignmentDoc.volunteerId = caregiverId;
      assignmentDoc.status = 'confirmed';
      assignmentDoc.autoApproved = false;
      await assignmentDoc.save();
    }

    // Send notifications to senior and family member
    const caregiverName = `${req.user.firstName} ${req.user.lastName || ''}`.trim();
    if (targetSenior?._id) {
      await createNotification({
        recipient: targetSenior._id,
        sender: caregiverId,
        senior: targetSenior._id,
        type: 'visit_approved',
        title: 'Caregiver Assigned! 🎉',
        message: `${caregiverName} has accepted your care visit for ${targetDate} at ${targetTime}.`,
        data: { assignmentId, date: targetDate, time: targetTime },
      });
    }

    if (targetFamilyMember) {
      await createNotification({
        recipient: targetFamilyMember,
        sender: caregiverId,
        senior: targetSenior?._id || null,
        type: 'visit_approved',
        title: 'Care Visit Confirmed 📅',
        message: `${caregiverName} accepted the care assignment for ${targetSenior?.firstName || 'your senior'} on ${targetDate} at ${targetTime}.`,
        data: { assignmentId, date: targetDate, time: targetTime },
      });
    }

    res.status(200).json({
      success: true,
      message: 'Assignment accepted successfully with no schedule conflicts.',
      data: assignmentDoc,
    });
  } catch (error) {
    console.error('Accept Assignment Error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while accepting assignment',
      error: error.message,
    });
  }
};

// @desc    Get completed visits for caregiver (Sprint 3)
// @route   GET /api/help-requests/caregiver/visits/completed
// @access  Private (Caregiver)
exports.getCompletedCaregiverVisits = async (req, res) => {
  try {
    const caregiverId = req.user._id;

    // 1. Completed HelpRequests
    const helpRequests = await HelpRequest.find({
      volunteerId: caregiverId,
      status: 'completed',
    })
      .populate('elderlyId', 'firstName lastName customId phone address')
      .sort({ completedAt: -1, createdAt: -1 });

    // 2. Completed CompanionshipRequests
    const companionshipRequests = await CompanionshipRequest.find({
      volunteer: caregiverId,
      status: 'completed',
    })
      .populate('elderly', 'firstName lastName customId phone address')
      .populate('activityId', 'name icon iconFamily')
      .sort({ scheduledDate: -1 });

    const completedVisits = [
      ...helpRequests.map((hr) => ({
        id: hr._id,
        type: 'help_request',
        serviceType: hr.serviceType,
        date: hr.date,
        time: hr.time,
        location: hr.location,
        status: 'completed',
        senior: hr.elderlyId,
        rating: hr.rating || 5,
        feedback: hr.feedback || '',
        completedAt: hr.completedAt || hr.updatedAt,
      })),
      ...companionshipRequests.map((cr) => ({
        id: cr._id,
        type: 'companionship',
        serviceType: cr.activityType || 'Companionship',
        date: cr.scheduledDate ? new Date(cr.scheduledDate).toISOString().split('T')[0] : '',
        time: cr.startTime || cr.timeSlot || '02:00 PM',
        location: cr.location || cr.elderly?.address?.streetAddress || '',
        status: 'completed',
        senior: cr.elderly,
        rating: 5,
        feedback: 'Great companionship session',
        completedAt: cr.updatedAt,
      })),
    ];

    const totalHours = completedVisits.length * 2; // Each visit averages 2 hours
    const avgRating = completedVisits.length > 0
      ? (completedVisits.reduce((acc, v) => acc + (v.rating || 5), 0) / completedVisits.length).toFixed(1)
      : '5.0';

    res.status(200).json({
      success: true,
      count: completedVisits.length,
      stats: {
        totalVisits: completedVisits.length,
        totalHours,
        averageRating: parseFloat(avgRating),
      },
      data: completedVisits,
    });
  } catch (error) {
    console.error('Get Completed Visits Error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while fetching completed visits',
      error: error.message,
    });
  }
};
