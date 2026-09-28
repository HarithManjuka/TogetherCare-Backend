// controllers/companionshipController.js
const CompanionshipRequest = require('../models/CompanionshipRequest');
const { createNotification } = require('./notificationController');

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
      .populate('volunteer', 'firstName lastName phone email profilePicture isEmailVerified verificationBadgeStatus')
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
      .populate('volunteer', 'firstName lastName phone email profilePicture isEmailVerified verificationBadgeStatus rating bio address')
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
    let request = await CompanionshipRequest.findOne({
      _id: id,
      elderly: req.user._id,
    });

    let serviceName = 'Companionship';
    let volunteerRecipient = null;
    let scheduledDateStr = 'Upcoming';
    let timeSlotStr = '';

    if (request) {
      if (request.status === 'completed') {
        return res.status(400).json({
          success: false,
          message: 'Cannot cancel a completed visit',
        });
      }
      request.status = 'cancelled';
      await request.save();

      serviceName = request.activityType || 'Companionship';
      volunteerRecipient = request.volunteer ? (request.volunteer._id || request.volunteer) : null;
      scheduledDateStr = request.scheduledDate
        ? new Date(request.scheduledDate).toISOString().split('T')[0]
        : 'Upcoming';
      timeSlotStr = request.timeSlot || '';
    } else {
      // Fallback: Check if it's stored in HelpRequest
      const HelpRequest = require('../models/HelpRequest');
      request = await HelpRequest.findOne({
        _id: id,
        elderlyId: req.user._id,
      });

      if (!request) {
        return res.status(404).json({
          success: false,
          message: 'Request not found',
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

      serviceName = request.serviceType || 'Assistance';
      volunteerRecipient = request.volunteerId ? (request.volunteerId._id || request.volunteerId) : null;
      scheduledDateStr = request.date || 'Upcoming';
      timeSlotStr = request.time || '';
    }

    // Send notification to volunteer if one was assigned
    if (volunteerRecipient) {
      try {
        const elderName = `${req.user.firstName} ${req.user.lastName || ''}`.trim();
        await createNotification({
          recipient: volunteerRecipient,
          sender: req.user._id,
          senior: req.user._id,
          type: 'visit_cancelled',
          title: 'Scheduled Visit Cancelled ⚠️',
          message: `${elderName} has cancelled the scheduled visit for ${serviceName} on ${scheduledDateStr} (${timeSlotStr}).`,
          data: { requestId: request._id, date: scheduledDateStr, time: timeSlotStr },
        });
      } catch (notifErr) {
        console.error('Failed to send visit_cancelled notification:', notifErr);
      }
    }

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
    if (location !== undefined) request.location = location;
    if (notes !== undefined) request.notes = notes;

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
      .populate('elderly', 'firstName lastName profilePicture phone address isEmailVerified verificationBadgeStatus age interests')
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

/**
 * @desc    Update status of companionship visit (accepted -> ongoing -> completed / cancelled)
 * @route   PUT /api/companionship/:id/status
 * @access  Private
 */
const updateStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    const allowed = ['pending', 'accepted', 'scheduled', 'ongoing', 'arrived', 'completed', 'cancelled'];
    if (!allowed.includes(status)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid status',
      });
    }

    const request = await CompanionshipRequest.findOne({
      _id: id,
      $or: [{ elderly: req.user._id }, { volunteer: req.user._id }],
    });

    if (!request) {
      return res.status(404).json({
        success: false,
        message: 'Companionship request not found or not authorized',
      });
    }

    request.status = status;
    await request.save();

    // Send notification to counterpart user
    const elderId = request.elderly || request.elderlyId;
    const volunteerId = request.volunteer || request.volunteerId;
    const isElder = req.user._id.toString() === elderId?.toString();
    const recipientId = isElder ? (volunteerId?._id || volunteerId) : (elderId?._id || elderId);

    if (recipientId) {
      try {
        const senderName = `${req.user.firstName} ${req.user.lastName || ''}`.trim();
        const activity = request.activityType || request.serviceType || 'Visit';
        const dateStr = request.scheduledDate
          ? new Date(request.scheduledDate).toISOString().split('T')[0]
          : request.date || 'Upcoming';

        if (status === 'ongoing') {
          await createNotification({
            recipient: recipientId,
            sender: req.user._id,
            senior: elderId,
            type: 'visit_status_update',
            title: isElder ? 'Elder Started Visit 🚀' : 'Volunteer Arrived / Ongoing 🚀',
            message: isElder
              ? `${senderName} marked the ${activity} visit as ongoing.`
              : `Volunteer ${senderName} has started the ${activity} visit.`,
            data: { requestId: request._id, status: 'ongoing' },
          });
        } else if (status === 'completed') {
          await createNotification({
            recipient: recipientId,
            sender: req.user._id,
            senior: elderId,
            type: 'visit_completed',
            title: 'Visit Completed! 🎉',
            message: isElder
              ? `${senderName} marked the ${activity} visit as completed. Thank you!`
              : `Volunteer ${senderName} has finished the ${activity} visit.`,
            data: { requestId: request._id, status: 'completed' },
          });
        } else if (status === 'cancelled') {
          await createNotification({
            recipient: recipientId,
            sender: req.user._id,
            senior: elderId,
            type: 'visit_cancelled',
            title: 'Scheduled Visit Cancelled ⚠️',
            message: isElder
              ? `${senderName} has cancelled the scheduled visit for ${activity} on ${dateStr}.`
              : `Volunteer ${senderName} has cancelled the visit for ${activity}.`,
            data: { requestId: request._id, status: 'cancelled', date: dateStr },
          });
        }
      } catch (notifErr) {
        console.error('Failed to send status update notification:', notifErr);
      }
    }

    return res.status(200).json({
      success: true,
      message: `Companionship visit status updated to ${status}`,
      data: request,
    });
  } catch (error) {
    console.error('Error updating companionship status:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error while updating status',
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
  updateStatus,
};


