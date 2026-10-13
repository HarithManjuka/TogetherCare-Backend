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
      enum: ['pending', 'accepted', 'scheduled', 'ongoing', 'arrived', 'completed', 'cancelled', 'expired', 'outdated'],
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
    // Rating for the visit itself
    visitRating: {
      type: Number,
      min: 1,
      max: 5,
      default: null,
    },
    visitReview: {
      type: String,
      trim: true,
      default: '',
    },
    // Rating for the volunteer companion
    volunteerRating: {
      type: Number,
      min: 1,
      max: 5,
      default: null,
    },
    volunteerReview: {
      type: String,
      trim: true,
      default: '',
    },
    // Alias fields for backward compatibility
    rating: {
      type: Number,
      min: 1,
      max: 5,
      default: null,
    },
    feedback: {
      type: String,
      trim: true,
      default: '',
    },
    ratedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model('CompanionshipRequest', CompanionshipRequestSchema);

