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

    // Find accepted upcoming visits for the current user from database
    const visits = await CompanionshipRequest.find({
      elderly: userId,
      status: 'accepted',
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
      .populate('volunteer', 'firstName lastName phone email profilePicture')
      .populate('activityId', 'name icon iconFamily')
      .sort({ scheduledDate: -1, createdAt: -1 });

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
 * @desc    Cancel a companionship request (by elderly user)
 * @route   PUT /api/companionship/:id/cancel
 * @access  Private
 */
const cancelRequest = async (req, res) => {
  try {
    const { id } = req.params;
    const request = await CompanionshipRequest.findOne({
      _id: id,
      elderly: req.user._id,
    });

    if (!request) {
      return res.status(404).json({
        success: false,
        message: 'Companionship request not found',
      });
    }

    if (request.status === 'completed') {
      return res.status(400).json({
        success: false,
        message: 'Cannot cancel a completed visit',
      });
    }

    request.status = 'cancelled';
    await request.save();

    return res.status(200).json({
      success: true,
      message: 'Companionship request cancelled successfully',
      data: request,
    });
  } catch (error) {
    console.error('Error cancelling companionship request:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error while cancelling request',
      error: error.message,
    });
  }
};

/**
 * @desc    Update an existing pending companionship request (by elderly user)
 * @route   PUT /api/companionship/:id
 * @access  Private
 */
const updateRequest = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      activityType,
      activityId,
      scheduledDate,
      timeSlot,
      startTime,
      endTime,
      communicationMethod,
      notes,
    } = req.body;

    const request = await CompanionshipRequest.findOne({
      _id: id,
      elderly: req.user._id,
    });

    if (!request) {
      return res.status(404).json({
        success: false,
        message: 'Companionship request not found',
      });
    }

    if (request.status !== 'pending') {
      return res.status(400).json({
        success: false,
        message: 'Only pending requests can be edited',
      });
    }

    if (activityType) request.activityType = activityType;
    if (activityId !== undefined) request.activityId = activityId;
    if (scheduledDate) request.scheduledDate = new Date(scheduledDate);
    if (startTime) request.startTime = startTime;
    if (endTime) request.endTime = endTime;
    if (timeSlot) request.timeSlot = timeSlot;
    if (communicationMethod) request.communicationMethod = communicationMethod;
    if (notes) request.notes = notes;

    await request.save();

    return res.status(200).json({
      success: true,
      message: 'Companionship request updated successfully',
      data: request,
    });
  } catch (error) {
    console.error('Error updating companionship request:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error while updating request',
      error: error.message,
    });
  }
};

/**
 * @desc    Delete a pending companionship request (by elderly user)
 * @route   DELETE /api/companionship/:id
 * @access  Private
 */
const deleteRequest = async (req, res) => {
  try {
    const { id } = req.params;
    const request = await CompanionshipRequest.findOneAndDelete({
      _id: id,
      elderly: req.user._id,
      status: 'pending',
    });

    if (!request) {
      return res.status(404).json({
        success: false,
        message: 'Pending companionship request not found or cannot be deleted',
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Companionship request deleted successfully',
      data: { id },
    });
  } catch (error) {
    console.error('Error deleting companionship request:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error while deleting request',
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
    const {
      activityType,
      activityId,
      scheduledDate,
      timeSlot,
      startTime,
      endTime,
      communicationMethod,
      location,
      notes,
      companionName,
    } = req.body;

    if (!activityType || !scheduledDate) {
      return res.status(400).json({
        success: false,
        message: 'Please provide activityType and scheduledDate',
      });
    }

    const calculatedTimeSlot =
      timeSlot || (startTime && endTime ? `${startTime} - ${endTime}` : startTime || '02:00 PM - 04:00 PM');

    const newRequest = await CompanionshipRequest.create({
      elderly: req.user._id,
      volunteer: null,
      acceptedBy: null,
      companionName: companionName || 'Awaiting Volunteer',
      activityType,
      activityId: activityId || null,
      scheduledDate: new Date(scheduledDate),
      timeSlot: calculatedTimeSlot,
      startTime: startTime || '02:00 PM',
      endTime: endTime || '04:00 PM',
      communicationMethod: communicationMethod || 'chat',
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

/**
 * @desc    Get all open/pending companionship requests (for volunteers to browse)
 * @route   GET /api/companionship/open-requests
 * @access  Private (Volunteer / All authenticated)
 */
const getOpenRequests = async (req, res) => {
  try {
    const openRequests = await CompanionshipRequest.find({
      status: 'pending',
      volunteer: null,
    })
      .populate('elderly', 'firstName lastName profilePicture phone address')
      .sort({ scheduledDate: 1, createdAt: -1 });

    return res.status(200).json({
      success: true,
      count: openRequests.length,
      data: openRequests,
    });
  } catch (error) {
    console.error('Error fetching open requests:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error while fetching open requests',
      error: error.message,
    });
  }
};

module.exports = {
  getUpcomingVisits,
  getMyRequests,
  getOpenRequests,
  createRequest,
  cancelRequest,
  updateRequest,
  deleteRequest,
};


