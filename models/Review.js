// models/Review.js
const mongoose = require('mongoose');

const ReviewSchema = new mongoose.Schema(
  {
    reviewer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'Reviewer ID is required'],
    },
    recipient: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'Recipient ID is required'],
    },
    rating: {
      type: Number,
      required: [true, 'Rating is required'],
      min: [1, 'Rating must be at least 1'],
      max: [5, 'Rating cannot exceed 5'],
    },
    comment: {
      type: String,
      trim: true,
      default: '',
    },
    activityType: {
      type: String,
      trim: true,
      default: 'companionship',
    },
  },
  {
    timestamps: true,
  }
);

// Compound index to quickly fetch reviews for a recipient
ReviewSchema.index({ recipient: 1, createdAt: -1 });

module.exports = mongoose.model('Review', ReviewSchema);
