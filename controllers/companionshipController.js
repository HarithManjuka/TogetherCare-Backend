// controllers/companionshipController.js
const CompanionshipRequest = require('../models/CompanionshipRequest');
const HelpRequest = require('../models/HelpRequest');
const { createNotification } = require('./notificationController');
const {
  getVisitTimeWindow,
  syncAndAutoTransitionVisits,
  checkElderScheduleOverlap,
} = require('../utils/scheduleHelper');

/**
 * @desc    Get upcoming companionship visits for logged-in elderly user
 * @route   GET /api/companionship/upcoming
 * @access  Private
 */
const getUpcomingVisits = async (req, res) => {
  try {
    const userId = req.user._id;
    const HelpRequest = require('../models/HelpRequest');

    // 1. Find accepted / ongoing companionship visits
    const compVisits = await CompanionshipRequest.find({
      elderly: userId,
      status: { $in: ['accepted', 'scheduled', 'ongoing'] },
    })
      .populate('volunteer', 'firstName lastName phone email profilePicture isEmailVerified verificationBadgeStatus')
      .sort({ scheduledDate: 1 });

    // 2. Find accepted / ongoing assistance help requests submitted by the elder
    const helpVisits = await HelpRequest.find({
      elderlyId: userId,
      status: { $in: ['confirmed', 'matched', 'ongoing', 'arrived'] },
    })
      .populate('volunteerId', 'firstName lastName phone email profilePicture isEmailVerified verificationBadgeStatus')
      .sort({ date: 1, time: 1 });

    // Auto-transition visits based on scheduled time frames
    await syncAndAutoTransitionVisits([...compVisits, ...helpVisits]);

    // Keep active upcoming & ongoing visits
    const activeComp = compVisits.filter(
      (v) => v.status !== 'completed' && v.status !== 'cancelled'
    );

    const activeHelp = helpVisits
      .filter((v) => v.status !== 'completed' && v.status !== 'cancelled')
      .map((hr) => ({
        _id: hr._id,
        id: hr._id,
        activityType: hr.serviceType || 'Elderly Assistance',
        serviceType: hr.serviceType || 'Elderly Assistance',
        scheduledDate: hr.date || 'Today',
        timeSlot: hr.time || '10:00 AM',
        date: hr.date,
        time: hr.time,
        location: hr.location || '',
        notes: hr.feedback || hr.notes || '',
        status: hr.status === 'confirmed' || hr.status === 'matched' ? 'accepted' : hr.status,
        volunteer: hr.volunteerId,
        companionName: hr.volunteerId ? `${hr.volunteerId.firstName} ${hr.volunteerId.lastName || ''}`.trim() : '',
        source: 'help_request',
      }));

    const allVisits = [...activeComp, ...activeHelp];

    return res.status(200).json({
      success: true,
      count: allVisits.length,
      data: allVisits,
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
    const HelpRequest = require('../models/HelpRequest');

    const compRequests = await CompanionshipRequest.find({ elderly: userId })
      .populate('volunteer', 'firstName lastName phone email profilePicture isEmailVerified verificationBadgeStatus rating bio address')
      .populate('activityId', 'name icon iconFamily')
      .sort({ scheduledDate: -1, createdAt: -1 });

    const helpRequests = await HelpRequest.find({ elderlyId: userId })
      .populate('volunteerId', 'firstName lastName phone email profilePicture isEmailVerified verificationBadgeStatus rating bio address')
      .sort({ createdAt: -1 });

    // Auto-transition visits based on scheduled time frames (upcoming -> ongoing -> completed, and expire outdated unaccepted requests)
    await syncAndAutoTransitionVisits([...compRequests, ...helpRequests]);

    const formattedHelp = helpRequests.map((hr) => ({
      _id: hr._id,
      id: hr._id,
      elderly: hr.elderlyId,
      activityType: hr.serviceType || 'Elderly Assistance',
      serviceType: hr.serviceType || 'Elderly Assistance',
      scheduledDate: hr.date || 'Today',
      timeSlot: hr.time || '10:00 AM',
      date: hr.date,
      time: hr.time,
      location: hr.location || '',
      notes: hr.feedback || hr.notes || '',
      communicationMethod: 'in_person',
      status: hr.status === 'searching' ? 'pending' : (hr.status === 'confirmed' || hr.status === 'matched') ? 'accepted' : hr.status,
      volunteer: hr.volunteerId,
      companionName: hr.volunteerId ? `${hr.volunteerId.firstName} ${hr.volunteerId.lastName || ''}`.trim() : '',
      source: 'help_request',
      createdAt: hr.createdAt,
    }));

    const rawList = [...compRequests, ...formattedHelp].sort((a, b) => {
      return new Date(b.createdAt || 0) - new Date(a.createdAt || 0);
    });

    // Deduplicate by string ID
    const seenIds = new Set();
    const allSchedules = [];
    for (const item of rawList) {
      const idStr = (item._id || item.id)?.toString();
      if (idStr && !seenIds.has(idStr)) {
        seenIds.add(idStr);
        allSchedules.push(item);
      }
    }

    return res.status(200).json({
      success: true,
      count: allSchedules.length,
      data: allSchedules,
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
      location,
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

    // Check for schedule overlap with other active schedules (excluding this request)
    const targetDate = scheduledDate || request.scheduledDate;
    const targetStartTime = startTime || request.startTime;
    const targetEndTime = endTime || request.endTime;
    const targetTimeSlot = timeSlot || request.timeSlot;

    const overlapCheck = await checkElderScheduleOverlap(
      req.user._id,
      {
        scheduledDate: targetDate,
        startTime: targetStartTime,
        endTime: targetEndTime,
        timeSlot: targetTimeSlot,
      },
      id
    );

    if (overlapCheck.hasConflict) {
      return res.status(400).json({
        success: false,
        message: overlapCheck.message,
        conflict: true,
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
 * @desc    Delete a pending companionship / help request (by elderly user)
 * @route   DELETE /api/companionship/:id
 * @access  Private
 */
const deleteRequest = async (req, res) => {
  try {
    const { id } = req.params;
    let request = await CompanionshipRequest.findOneAndDelete({
      _id: id,
      elderly: req.user._id,
      status: 'pending',
    });

    if (!request) {
      request = await HelpRequest.findOneAndDelete({
        _id: id,
        elderlyId: req.user._id,
        status: { $in: ['pending', 'searching'] },
      });
    }

    if (!request) {
      return res.status(404).json({
        success: false,
        message: 'Pending request not found or cannot be deleted',
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Request deleted successfully',
      data: { id },
    });
  } catch (error) {
    console.error('Error deleting request:', error);
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

    // Check for overlapping active schedules for this elder
    const overlapCheck = await checkElderScheduleOverlap(req.user._id, {
      scheduledDate,
      startTime,
      endTime,
      timeSlot: calculatedTimeSlot,
    });

    if (overlapCheck.hasConflict) {
      return res.status(400).json({
        success: false,
        message: overlapCheck.message,
        conflict: true,
      });
    }

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

    // Auto-transition and expire outdated requests that were never accepted
    await syncAndAutoTransitionVisits(openRequests);

    const activeOpen = openRequests.filter((r) => r.status === 'pending');

    return res.status(200).json({
      success: true,
      count: activeOpen.length,
      data: activeOpen,
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
 * @desc    Update status of companionship / help visit (accepted -> ongoing -> completed / cancelled)
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

    let request = await CompanionshipRequest.findOne({
      _id: id,
      $or: [{ elderly: req.user._id }, { volunteer: req.user._id }],
    });

    let isHelpModel = false;
    if (!request) {
      request = await HelpRequest.findOne({
        _id: id,
        $or: [{ elderlyId: req.user._id }, { caregiverId: req.user._id }, { volunteerId: req.user._id }],
      });
      if (request) {
        isHelpModel = true;
      }
    }

    if (!request) {
      return res.status(404).json({
        success: false,
        message: 'Request not found or not authorized',
      });
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
    if (isHelpModel) {
      if (status === 'ongoing') {
        request.trackingConsent = true;
        request.tripStartedAt = Date.now();
      } else if (status === 'arrived') {
        request.arrivedAt = Date.now();
      } else if (status === 'completed') {
        request.completedAt = Date.now();
      }
    }

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
      message: `Visit status updated to ${status}`,
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

/**
 * @desc    Submit rating and review for a completed companionship visit and/or volunteer
 * @route   POST /api/companionship/:id/rate
 * @access  Private (Elderly)
 */
const rateVisit = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      visitRating,
      visitReview,
      volunteerRating,
      volunteerReview,
      rating,
      feedback,
    } = req.body;

    const Review = require('../models/Review');
    const User = require('../models/User');

    // 1. Find request by ID (CompanionshipRequest or HelpRequest)
    let request = await CompanionshipRequest.findOne({
      _id: id,
      elderly: req.user._id,
    }).populate('volunteer', 'firstName lastName email phone profilePicture rating ratingCount');

    let isHelpModel = false;
    if (!request) {
      request = await HelpRequest.findOne({
        _id: id,
        elderlyId: req.user._id,
      }).populate('volunteerId', 'firstName lastName email phone profilePicture rating ratingCount');
      if (request) isHelpModel = true;
    }

    if (!request) {
      return res.status(404).json({
        success: false,
        message: 'Completed visit not found for rating',
      });
    }

    // 2. Normalize ratings
    const parsedVisitRating = visitRating !== undefined && visitRating !== null && visitRating > 0
      ? Math.min(5, Math.max(1, parseInt(visitRating, 10)))
      : (rating && rating > 0 ? Math.min(5, Math.max(1, parseInt(rating, 10))) : null);

    const parsedVolunteerRating = volunteerRating !== undefined && volunteerRating !== null && volunteerRating > 0
      ? Math.min(5, Math.max(1, parseInt(volunteerRating, 10)))
      : null;

    const cleanVisitReview = (visitReview || feedback || '').trim();
    const cleanVolunteerReview = (volunteerReview || '').trim();

    // Check that at least one rating or review was provided
    if (!parsedVisitRating && !cleanVisitReview && !parsedVolunteerRating && !cleanVolunteerReview) {
      return res.status(400).json({
        success: false,
        message: 'Please provide at least a visit rating/review or volunteer rating/review to submit.',
      });
    }

    // 3. Update Request ratings
    if (parsedVisitRating) request.visitRating = parsedVisitRating;
    if (cleanVisitReview) request.visitReview = cleanVisitReview;
    if (parsedVolunteerRating) request.volunteerRating = parsedVolunteerRating;
    if (cleanVolunteerReview) request.volunteerReview = cleanVolunteerReview;

    // Backward compatibility
    request.rating = parsedVisitRating || parsedVolunteerRating || request.rating || 5;
    request.feedback = cleanVisitReview || cleanVolunteerReview || request.feedback || '';
    request.ratedAt = new Date();

    await request.save();

    // 4. Update Volunteer Stats & Send Notification if Volunteer rated
    const volunteerObj = isHelpModel ? request.volunteerId : request.volunteer;
    const volunteerId = volunteerObj?._id || volunteerObj;

    if (volunteerId) {
      const effectiveVolRating = parsedVolunteerRating || parsedVisitRating;
      const effectiveVolComment = cleanVolunteerReview || cleanVisitReview;
      const scheduleModelName = (request.constructor.modelName === 'HelpRequest' || isHelpModel) ? 'HelpRequest' : 'CompanionshipRequest';

      if (effectiveVolRating || effectiveVolComment) {
        // Upsert Review entry: replaces previous rating for this visit so no duplicate ratings exist
        try {
          let existingReview = await Review.findOne({
            reviewer: req.user._id,
            recipient: volunteerId,
            scheduleId: request._id,
          });

          if (!existingReview) {
            existingReview = await Review.findOne({
              reviewer: req.user._id,
              recipient: volunteerId,
              scheduleId: { $exists: false },
              activityType: request.activityType || request.serviceType || 'Companionship',
            });
          }

          if (existingReview) {
            existingReview.rating = effectiveVolRating || 5;
            existingReview.comment = effectiveVolComment || '';
            existingReview.activityType = request.activityType || request.serviceType || 'Companionship';
            existingReview.scheduleId = request._id;
            existingReview.scheduleModel = scheduleModelName;
            existingReview.visitRating = parsedVisitRating || null;
            existingReview.visitReview = cleanVisitReview || '';
            await existingReview.save();
          } else {
            await Review.create({
              reviewer: req.user._id,
              recipient: volunteerId,
              rating: effectiveVolRating || 5,
              comment: effectiveVolComment || '',
              activityType: request.activityType || request.serviceType || 'Companionship',
              scheduleId: request._id,
              scheduleModel: scheduleModelName,
              visitRating: parsedVisitRating || null,
              visitReview: cleanVisitReview || '',
            });
          }
        } catch (revErr) {
          console.error('Error recording review document:', revErr);
        }
      } else {
        // If rating was cleared/removed, remove previous review for this schedule
        try {
          await Review.deleteMany({
            reviewer: req.user._id,
            recipient: volunteerId,
            scheduleId: request._id,
          });
        } catch (delErr) {
          console.error('Error cleaning up removed review:', delErr.message);
        }
      }

      // Recalculate volunteer rating metrics from database
      try {
        const allReviews = await Review.find({ recipient: volunteerId });
        if (allReviews.length > 0) {
          const sum = allReviews.reduce((acc, curr) => acc + (curr.rating || 0), 0);
          const avgRating = Number((sum / allReviews.length).toFixed(1));
          await User.findByIdAndUpdate(volunteerId, {
            rating: avgRating,
            ratingCount: allReviews.length,
            totalReviews: allReviews.length,
          });
        } else {
          await User.findByIdAndUpdate(volunteerId, {
            rating: 0,
            ratingCount: 0,
            totalReviews: 0,
          });
        }
      } catch (statsErr) {
        console.error('Error updating volunteer rating stats:', statsErr.message);
      }

      // Send Notification to volunteer
      if (effectiveVolRating || effectiveVolComment) {
        try {
          const elderName = `${req.user.firstName || 'Elder'} ${req.user.lastName || ''}`.trim();
          const activityName = request.activityType || request.serviceType || 'Companionship';
          const starLabel = effectiveVolRating ? `${effectiveVolRating} ⭐` : 'a review';

          await createNotification({
            recipient: volunteerId,
            sender: req.user._id,
            senior: req.user._id,
            type: 'visit_reviewed',
            title: 'New Rating & Review Received ⭐',
            message: `${elderName} rated you ${starLabel} for your ${activityName} visit${effectiveVolComment ? `: "${effectiveVolComment}"` : '.'}`,
            data: {
              requestId: request._id,
              scheduleId: request._id,
              visitRating: parsedVisitRating,
              volunteerRating: parsedVolunteerRating,
              volunteerReview: cleanVolunteerReview,
            },
          });
        } catch (notifErr) {
          console.error('Error sending review notification to volunteer:', notifErr.message);
        }
      }
    }

    return res.status(200).json({
      success: true,
      message: 'Rating and review submitted successfully',
      data: request,
    });
  } catch (error) {
    console.error('Error submitting visit/volunteer rating:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error while submitting rating',
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
  rateVisit,
};


