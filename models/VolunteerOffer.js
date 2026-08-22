// models/VolunteerOffer.js
const mongoose = require('mongoose');

const VolunteerOfferSchema = new mongoose.Schema(
  {
    volunteerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    volunteerName: {
      type: String,
      required: true,
      trim: true,
    },
    services: {
      type: [String],
      required: [true, 'Please select at least one service'],
      validate: {
        validator: function (v) {
          return Array.isArray(v) && v.length > 0;
        },
        message: 'You must select at least one service to provide',
      },
    },
    date: {
      type: String, // Format: YYYY-MM-DD
      required: [true, 'Available date is required'],
    },
    startTime: {
      type: String, // e.g. "02:00 PM"
      required: [true, 'Start time is required'],
    },
    endTime: {
      type: String, // e.g. "04:00 PM"
      required: [true, 'End time is required'],
    },
    serviceArea: {
      type: String,
      required: [true, 'Service area is required'],
      trim: true,
    },
    radius: {
      type: String,
      default: 'Within 5 km',
    },
    capacity: {
      type: Number,
      required: [true, 'Capacity is required'],
      min: [1, 'Capacity must be at least 1 elder'],
      max: [5, 'Capacity cannot exceed 5 elders per trip'],
      default: 2,
    },
    slotsLeft: {
      type: Number,
      required: true,
      min: 0,
      default: 2,
    },
    specialSkills: {
      type: String,
      maxlength: [200, 'Extra details cannot exceed 200 characters'],
      trim: true,
      default: '',
    },
    status: {
      type: String,
      enum: ['pending', 'active', 'booked', 'completed', 'cancelled'],
      default: 'pending',
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model('VolunteerOffer', VolunteerOfferSchema);
