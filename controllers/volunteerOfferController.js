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

    if (service) {
      query.services = { $in: [service] };
    }
    if (location) {
      query.serviceArea = { $regex: location, $options: 'i' };
    }

    const offers = await VolunteerOffer.find(query).sort({ date: 1, createdAt: -1 });

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
