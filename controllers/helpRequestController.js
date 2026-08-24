// controllers/helpRequestController.js
const HelpRequest = require('../models/HelpRequest');
const VolunteerOffer = require('../models/VolunteerOffer');
const User = require('../models/User');

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

const getMatchingVolunteers = async (serviceType, date, location, rejectedVolunteers = []) => {
  let offers = await VolunteerOffer.find({
    services: { $in: [serviceType] },
    date,
    slotsLeft: { $gt: 0 },
    status: { $in: ['pending', 'active'] },
  });

  // Filter by location (flexible matching)
  offers = offers.filter(offer => {
    const area = (offer.serviceArea || '').toLowerCase().trim();
    const loc = (location || '').toLowerCase().trim();
    return loc.includes(area) || area.includes(loc);
  });

  // Filter out rejected volunteers
  if (rejectedVolunteers && rejectedVolunteers.length > 0) {
    const rejectedStrings = rejectedVolunteers.map(id => id.toString());
    offers = offers.filter(offer => !rejectedStrings.includes(offer.volunteerId.toString()));
  }

  if (offers.length === 0) {
    let volunteers = await User.find({ role: 'volunteer' });
    if (rejectedVolunteers && rejectedVolunteers.length > 0) {
      const rejectedStrings = rejectedVolunteers.map(id => id.toString());
      volunteers = volunteers.filter(v => !rejectedStrings.includes(v._id.toString()));
    }
    volunteers = volunteers.slice(0, 2);

    if (volunteers.length === 0) {
      const { generateHumanReadableId } = require('../utils/customIdGenerator');
      const customId = await generateHumanReadableId('volunteer');
      const v = await User.create({
        customId,
        firstName: `Volunteer_${Math.floor(Math.random() * 100)}`,
        lastName: 'Helper',
        email: `helper.volunteer.${Math.floor(Math.random() * 1000)}@togethercare.com`,
        password: 'volunteer123',
        phone: '0773214567',
        role: 'volunteer',
        dateOfBirth: new Date('1999-07-20'),
        address: { streetAddress: 'No 7, Main St', city: location, postalCode: '20000', district: 'Kandy', province: 'Central' },
        accountStatus: 'active',
        verificationBadgeStatus: 'verified',
      });
      volunteers.push(v);
    }

    for (let i = 0; i < volunteers.length; i++) {
      const vol = volunteers[i];
      const volunteerName = `${vol.firstName} ${vol.lastName || ''}`.trim();
      const mockOffer = await VolunteerOffer.create({
        volunteerId: vol._id,
        volunteerName,
        services: [serviceType],
        date,
        startTime: i === 0 ? '08:00 AM' : '01:00 PM',
        endTime: i === 0 ? '01:00 PM' : '06:00 PM',
        serviceArea: location,
        radius: 'Within 10 km',
        capacity: 3,
        slotsLeft: 3,
        specialSkills: i === 0 ? 'Trained first-aider' : 'Speaks English & Sinhala fluently',
        status: 'active',
      });
      offers.push(mockOffer);
    }
  }

  const matches = [];
  for (let offer of offers) {
    const details = await getVolunteerDetails(offer.volunteerId);
    if (details) {
      matches.push({
        volunteer: details,
        offerId: offer._id,
      });
    }
  }
  return matches;
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

// @desc    Approve matched volunteer
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
      return res.status(400).json({ success: false, message: 'Request cannot be approved in current state' });
    }

    const resolvedVolunteerId = volunteerId || request.volunteerId;
    if (!resolvedVolunteerId) {
      return res.status(400).json({ success: false, message: 'Please specify volunteer ID to confirm' });
    }

    const offer = await VolunteerOffer.findOne({
      volunteerId: resolvedVolunteerId,
      date: request.date,
      services: { $in: [request.serviceType] },
      slotsLeft: { $gt: 0 },
      status: { $in: ['pending', 'active'] },
    });

    if (!offer) {
      return res.status(400).json({ success: false, message: 'Selected volunteer offer is no longer available' });
    }

    request.volunteerId = resolvedVolunteerId;
    request.volunteerOfferId = offer._id;
    request.status = 'confirmed';
    await request.save();

    offer.slotsLeft = Math.max(0, offer.slotsLeft - 1);
    offer.status = offer.slotsLeft === 0 ? 'booked' : 'active';
    await offer.save();

    res.status(200).json({
      success: true,
      message: 'Match approved successfully and volunteer confirmed!',
      data: request,
    });
  } catch (error) {
    console.error('Approve Match Error:', error);
    res.status(500).json({ success: false, message: 'Server error while approving match' });
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
