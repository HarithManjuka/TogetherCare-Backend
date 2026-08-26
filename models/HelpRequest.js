// models/HelpRequest.js
const mongoose = require('mongoose');

const HelpRequestSchema = new mongoose.Schema(
  {
    caregiverId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    elderlyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    serviceType: {
      type: String,
      required: [true, 'Please select service type'],
      enum: ['Companionship', 'Grocery', 'Medicine'],
    },
    date: {
      type: String, // Format: YYYY-MM-DD
      required: [true, 'Available date is required'],
    },
    time: {
      type: String, // Format: HH:MM AM/PM
      required: [true, 'Start time is required'],
    },
    location: {
      type: String,
      required: [true, 'Location is required'],
      trim: true,
    },
    status: {
      type: String,
      enum: ['searching', 'matched', 'confirmed', 'arrived', 'completed', 'cancelled'],
      default: 'searching',
    },
    volunteerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    volunteerOfferId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'VolunteerOffer',
      default: null,
    },
    autoApproved: {
      type: Boolean,
      default: false,
    },
    rejectedVolunteers: {
      type: [mongoose.Schema.Types.ObjectId],
      ref: 'User',
      default: [],
    },
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
    sosTriggered: {
      type: Boolean,
      default: false,
    },
    sosTriggeredAt: {
      type: Date,
      default: null,
    },
    arrivedAt: {
      type: Date,
      default: null,
    },
    completedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model('HelpRequest', HelpRequestSchema);
