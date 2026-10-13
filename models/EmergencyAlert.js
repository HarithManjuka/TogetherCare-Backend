// models/EmergencyAlert.js
const mongoose = require('mongoose');

const EmergencyAlertSchema = new mongoose.Schema(
  {
    // Senior User who triggered the emergency
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'User reference is required'],
      index: true,
    },
    // Type of emergency
    emergencyType: {
      type: String,
      enum: ['medical', 'fall', 'urgent_help', 'fire', 'general'],
      default: 'general',
    },
    // Status of alert
    status: {
      type: String,
      enum: ['active', 'resolved', 'cancelled', 'false_alarm'],
      default: 'active',
      index: true,
    },
    // User location / address snapshot
    location: {
      type: String,
      trim: true,
      default: '',
    },
    coordinates: {
      latitude: { type: Number, default: null },
      longitude: { type: Number, default: null },
    },
    // Snapshot of emergency contact at time of alert
    emergencyContact: {
      name: { type: String, default: '' },
      relation: { type: String, default: '' },
      phone: { type: String, default: '' },
    },
    // Linked caregiver info if present
    linkedCaregiver: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    // Timestamps
    triggeredAt: {
      type: Date,
      default: Date.now,
    },
    resolvedAt: {
      type: Date,
      default: null,
    },
    resolutionNotes: {
      type: String,
      trim: true,
      default: '',
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model('EmergencyAlert', EmergencyAlertSchema);
