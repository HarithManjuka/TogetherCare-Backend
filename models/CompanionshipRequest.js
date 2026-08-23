// models/CompanionshipRequest.js
const mongoose = require('mongoose');

const CompanionshipRequestSchema = new mongoose.Schema(
  {
    elderly: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'Elderly user reference is required'],
    },
    volunteer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    companionName: {
      type: String,
      trim: true,
      default: '',
    },
    activityType: {
      type: String,
      required: [true, 'Activity type is required'],
      enum: ['walk', 'coffee', 'chat', 'groceries', 'reading', 'medical', 'other'],
      default: 'walk',
    },
    scheduledDate: {
      type: Date,
      required: [true, 'Scheduled date is required'],
    },
    timeSlot: {
      type: String,
      required: [true, 'Time slot is required'],
      default: '12:00 PM',
    },
    status: {
      type: String,
      enum: ['pending', 'accepted', 'completed', 'cancelled'],
      default: 'accepted',
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
