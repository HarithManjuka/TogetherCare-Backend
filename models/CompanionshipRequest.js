// models/CompanionshipRequest.js
const mongoose = require('mongoose');

const CompanionshipRequestSchema = new mongoose.Schema(
  {
    // Elderly User who created the companionship request
    elderly: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'Elderly user reference is required'],
      index: true,
    },
    // Volunteer / User ID who accepts the request (null while pending)
    volunteer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
      index: true,
    },
    acceptedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    acceptedAt: {
      type: Date,
      default: null,
    },
    companionName: {
      type: String,
      trim: true,
      default: 'Awaiting Volunteer',
    },
    activityType: {
      type: String,
      required: [true, 'Activity type is required'],
      trim: true,
      default: 'Walk',
    },
    activityId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Activity',
      default: null,
    },
    scheduledDate: {
      type: Date,
      required: [true, 'Scheduled date is required'],
    },
    timeSlot: {
      type: String,
      required: [true, 'Time slot is required'],
      default: '02:00 PM - 04:00 PM',
    },
    startTime: {
      type: String,
      default: '02:00 PM',
    },
    endTime: {
      type: String,
      default: '04:00 PM',
    },
    communicationMethod: {
      type: String,
      enum: ['call', 'chat', 'video', 'in_person'],
      default: 'in_person',
    },
    status: {
      type: String,
      enum: ['pending', 'accepted', 'completed', 'cancelled'],
      default: 'pending',
    },
    location: {
      type: String,
      trim: true,
      default: '',
    },
    notes: {
      type: String,
      trim: true,
      default: '',
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model('CompanionshipRequest', CompanionshipRequestSchema);

