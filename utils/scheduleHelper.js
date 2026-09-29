// utils/scheduleHelper.js
/**
 * Utility helper for calculating schedule time frames and auto-transitioning
 * visits between 'upcoming' (accepted/confirmed), 'ongoing', and 'completed'.
 */

const parseTimeToHoursMinutes = (tStr) => {
  if (!tStr || typeof tStr !== 'string') return null;
  const clean = tStr.trim();
  const isPM = /pm/i.test(clean);
  const isAM = /am/i.test(clean);
  const numPart = clean.replace(/[^\d:]/g, '').trim();
  const parts = numPart.split(':');
  let hours = parseInt(parts[0], 10);
  let minutes = parts.length > 1 ? parseInt(parts[1], 10) : 0;
  if (isNaN(hours)) return null;
  if (isNaN(minutes)) minutes = 0;

  if (isPM && hours < 12) hours += 12;
  if (isAM && hours === 12) hours = 0;

  return { hours, minutes };
};

/**
 * Resolves exact start and end Date objects for any scheduled visit or help request.
 */
const getVisitTimeWindow = (item) => {
  if (!item) {
    const now = new Date();
    return {
      startDateTime: now,
      endDateTime: new Date(now.getTime() + 2 * 60 * 60 * 1000),
      dateStr: now.toISOString().split('T')[0],
      startStr: 'Now',
      endStr: 'Later',
    };
  }

  // 1. Resolve date (timezone-safe)
  let year, monthIndex, day;
  const rawDateStr = typeof item.scheduledDate === 'string' ? item.scheduledDate : (typeof item.date === 'string' ? item.date : null);

  if (rawDateStr && rawDateStr.toLowerCase() === 'today') {
    const d = new Date();
    year = d.getFullYear();
    monthIndex = d.getMonth();
    day = d.getDate();
  } else if (rawDateStr && /^\d{4}-\d{2}-\d{2}/.test(rawDateStr)) {
    const parts = rawDateStr.split('T')[0].split('-').map(Number);
    year = parts[0];
    monthIndex = parts[1] - 1;
    day = parts[2];
  } else if (item.scheduledDate) {
    const d = new Date(item.scheduledDate);
    if (!isNaN(d.getTime())) {
      year = d.getFullYear();
      monthIndex = d.getMonth();
      day = d.getDate();
    }
  } else if (item.date) {
    const d = new Date(item.date);
    if (!isNaN(d.getTime())) {
      year = d.getFullYear();
      monthIndex = d.getMonth();
      day = d.getDate();
    }
  }

  if (year === undefined) {
    const d = new Date();
    year = d.getFullYear();
    monthIndex = d.getMonth();
    day = d.getDate();
  }

  const dateStr = `${year}-${String(monthIndex + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

  // 2. Resolve start time & end time strings
  let startStr = item.startTime || '';
  let endStr = item.endTime || '';

  const rawTime = item.timeSlot || item.time || '';
  if (rawTime && (!startStr || !endStr)) {
    const timeTokens = rawTime.match(/\b\d{1,2}(?::\d{2})?\s*(?:am|pm|AM|PM)\b/g);
    if (timeTokens && timeTokens.length > 0) {
      if (!startStr) startStr = timeTokens[0];
      if (!endStr && timeTokens.length > 1) endStr = timeTokens[1];
    } else if (rawTime.includes('-')) {
      const parts = rawTime.split('-');
      if (!startStr) startStr = parts[0].trim();
      if (!endStr && parts.length > 1) endStr = parts[1].trim();
    } else if (!startStr) {
      startStr = rawTime.trim();
    }
  }

  const parsedStart = parseTimeToHoursMinutes(startStr) || { hours: 9, minutes: 0 };
  const parsedEnd = parseTimeToHoursMinutes(endStr) || {
    hours: (parsedStart.hours + 2) % 24,
    minutes: parsedStart.minutes,
  };

  const startDateTime = new Date(year, monthIndex, day, parsedStart.hours, parsedStart.minutes, 0, 0);
  let endDateTime = new Date(year, monthIndex, day, parsedEnd.hours, parsedEnd.minutes, 0, 0);

  if (endDateTime <= startDateTime) {
    endDateTime = new Date(startDateTime.getTime() + 2 * 60 * 60 * 1000); // 2 hours default
  }

  // 5 minutes early start window
  const earlyStartDateTime = new Date(startDateTime.getTime() - 5 * 60 * 1000);

  return {
    startDateTime,
    endDateTime,
    earlyStartDateTime,
    dateStr,
    startStr: startStr || '09:00 AM',
    endStr: endStr || '11:00 AM',
  };
};

/**
 * Auto-transitions visits based on exact schedule time frames:
 * - Automatically starts at exact start time (now >= startDateTime && now < endDateTime) -> moves to 'ongoing'.
 * - Automatically completes at exact end time (now >= endDateTime) -> moves to 'completed'.
 * - Does not complete before end time.
 */
const syncAndAutoTransitionVisits = async (visits) => {
  if (!visits || !Array.isArray(visits) || visits.length === 0) {
    return visits;
  }

  const now = new Date();
  const updatePromises = [];

  for (const item of visits) {
    if (!item) continue;
    const currentStatus = (item.status || '').toLowerCase();

    // Skip already cancelled or expired visits
    if (['cancelled', 'expired', 'outdated'].includes(currentStatus)) {
      continue;
    }

    const { startDateTime, endDateTime } = getVisitTimeWindow(item);

    // 0. Auto-expire outdated requests if they were never accepted and end time passed
    if (['pending', 'searching'].includes(currentStatus)) {
      if (now >= endDateTime) {
        item.status = 'expired';
        if (typeof item.save === 'function') {
          updatePromises.push(item.save().catch((err) => {
            console.error('Error auto-expiring outdated unaccepted request:', err.message);
          }));
        }
      }
      continue;
    }

    // 1. If accepted visit has reached or passed end time -> automatically complete exactly at end time
    if (now >= endDateTime) {
      if (currentStatus !== 'completed') {
        item.status = 'completed';
        if (typeof item.save === 'function') {
          updatePromises.push(item.save().catch((err) => {
            console.error('Error auto-completing visit at end time:', err.message);
          }));
        }
      }
    }
    // 2. If accepted visit has reached exact start time but before end time -> automatically start to ongoing
    else if (now >= startDateTime && now < endDateTime) {
      if (['accepted', 'scheduled', 'confirmed'].includes(currentStatus)) {
        item.status = 'ongoing';
        if (typeof item.save === 'function') {
          updatePromises.push(item.save().catch((err) => {
            console.error('Error auto-starting visit at start time:', err.message);
          }));
        }
      }
    }
  }

  if (updatePromises.length > 0) {
    await Promise.allSettled(updatePromises);
  }

  return visits;
};

/**
 * Checks if a candidate schedule window overlaps with any existing active schedule for an elder.
 * @param {string|ObjectId} elderlyId
 * @param {Object} candidate - { scheduledDate / date, startTime, endTime, timeSlot }
 * @param {string|ObjectId} [excludeId] - Optional schedule ID to exclude (for updates)
 * @returns {Promise<{ hasConflict: boolean, conflictingSchedule?: Object, message?: string }>}
 */
const checkElderScheduleOverlap = async (elderlyId, candidate, excludeId = null) => {
  if (!elderlyId || !candidate) return { hasConflict: false };

  const candidateWindow = getVisitTimeWindow(candidate);
  const CompanionshipRequest = require('../models/CompanionshipRequest');
  const HelpRequest = require('../models/HelpRequest');

  const excludeIdStr = excludeId ? excludeId.toString() : null;

  // Active statuses that occupy the elder's time
  const activeCompStatuses = ['pending', 'accepted', 'scheduled', 'upcoming', 'ongoing', 'in_progress', 'arrived'];
  const activeHelpStatuses = ['pending', 'searching', 'confirmed', 'accepted', 'scheduled', 'ongoing', 'in_progress', 'arrived'];

  const [compVisits, helpVisits] = await Promise.all([
    CompanionshipRequest.find({
      elderly: elderlyId,
      status: { $in: activeCompStatuses },
    }),
    HelpRequest.find({
      elderlyId: elderlyId,
      status: { $in: activeHelpStatuses },
    }),
  ]);

  const now = new Date();
  const allVisits = [...compVisits, ...helpVisits];

  for (const existing of allVisits) {
    if (excludeIdStr && existing._id && existing._id.toString() === excludeIdStr) {
      continue;
    }

    const existingStatus = (existing.status || '').toLowerCase();
    if (['cancelled', 'completed', 'expired', 'outdated', 'rejected'].includes(existingStatus)) {
      continue;
    }

    const existingWindow = getVisitTimeWindow(existing);

    // If existing is unaccepted pending and its end time has already passed, skip
    if (['pending', 'searching'].includes(existingStatus) && now >= existingWindow.endDateTime) {
      continue;
    }

    // Compare date strings
    if (candidateWindow.dateStr === existingWindow.dateStr) {
      const startA = candidateWindow.startDateTime.getTime();
      const endA = candidateWindow.endDateTime.getTime();
      const startB = existingWindow.startDateTime.getTime();
      const endB = existingWindow.endDateTime.getTime();

      // Check time overlap: (startA < endB && startB < endA)
      if (startA < endB && startB < endA) {
        const activityTitle = existing.activityType || existing.serviceType || 'Visit';
        const existingTime = existing.timeSlot || `${existingWindow.startStr} - ${existingWindow.endStr}`;
        const existingStatusLabel = ['pending', 'searching'].includes(existingStatus)
          ? 'pending request'
          : 'scheduled visit';

        return {
          hasConflict: true,
          conflictingSchedule: existing,
          message: `Schedule conflict: You already have a ${existingStatusLabel} for "${activityTitle}" on ${candidateWindow.dateStr} at ${existingTime} that overlaps with this time.`,
        };
      }
    }
  }

  return { hasConflict: false };
};

module.exports = {
  parseTimeToHoursMinutes,
  getVisitTimeWindow,
  syncAndAutoTransitionVisits,
  checkElderScheduleOverlap,
};
