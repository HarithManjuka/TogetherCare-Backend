// models/Notification.js
const mongoose = require('mongoose');

const NotificationSchema = new mongoose.Schema(
  {
    recipient: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'Recipient user reference is required'],
      index: true,
    },
    sender: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    senior: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    type: {
      type: String,
      enum: [
        'sos_alert',
        'volunteer_matched',
        'visit_requested',
        'visit_accepted',
        'visit_declined',
        'visit_cancelled',
        'visit_status_update',
        'trip_started',
        'visit_approved',
        'visit_started',
        'visit_completed',
        'visit_reviewed',
        'review_received',
        'schedule_conflict',
        'message',
        'activity_alert',
        'link_request',
        'link_approved',
        'link_rejected',
        'general',
      ],
      default: 'general',
      index: true,
    },
    title: {
      type: String,
      required: [true, 'Notification title is required'],
      trim: true,
    },
    message: {
      type: String,
      required: [true, 'Notification message body is required'],
      trim: true,
    },
    data: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    isRead: {
      type: Boolean,
      default: false,
      index: true,
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model('Notification', NotificationSchema);
