// controllers/companionshipController.js
const CompanionshipRequest = require('../models/CompanionshipRequest');

/**
 * @desc    Get upcoming companionship visits for logged-in elderly user
 * @route   GET /api/companionship/upcoming
 * @access  Private
 */
const getUpcomingVisits = async (req, res) => {
  try {
    const userId = req.user._id;

    // Find upcoming requests for the current user from database
    const visits = await CompanionshipRequest.find({
      elderly: userId,
      status: { $in: ['accepted', 'pending', 'scheduled'] },
    })
      .populate('volunteer', 'firstName lastName phone email')
      .sort({ scheduledDate: 1 });

    return res.status(200).json({
      success: true,
      count: visits.length,
      data: visits,
    });
  } catch (error) {
    console.error('Error fetching upcoming visits from database:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error while fetching upcoming visits',
      error: error.message,
    });
  }
};

/**
 * @desc    Get all companionship requests/schedules for logged-in user
 * @route   GET /api/companionship/my-requests
 * @access  Private
 */
const getMyRequests = async (req, res) => {
  try {
    const userId = req.user._id;
    const requests = await CompanionshipRequest.find({ elderly: userId })
      .populate('volunteer', 'firstName lastName phone email')
      .sort({ scheduledDate: 1, createdAt: -1 });

    return res.status(200).json({
      success: true,
      count: requests.length,
      data: requests,
    });
  } catch (error) {
    console.error('Error fetching schedules from database:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error while fetching schedules',
      error: error.message,
    });
  }
};

/**
 * @desc    Create new companionship request
 * @route   POST /api/companionship/create
 * @access  Private
 */
const createRequest = async (req, res) => {
  try {
    const { activityType, scheduledDate, timeSlot, location, notes, companionName } = req.body;

    if (!activityType || !scheduledDate || !timeSlot) {
      return res.status(400).json({
        success: false,
        message: 'Please provide activityType, scheduledDate, and timeSlot',
      });
    }

    const newRequest = await CompanionshipRequest.create({
      elderly: req.user._id,
      companionName: companionName || 'Assigned Volunteer',
      activityType,
      scheduledDate: new Date(scheduledDate),
      timeSlot,
      location: location || '',
      notes: notes || '',
      status: 'pending',
    });

    return res.status(201).json({
      success: true,
      message: 'Companionship request created successfully in database',
      data: newRequest,
    });
  } catch (error) {
    console.error('Error creating companionship request:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error while creating request',
      error: error.message,
    });
  }
};

module.exports = {
  getUpcomingVisits,
  getMyRequests,
  createRequest,
};
