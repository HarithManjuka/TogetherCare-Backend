// models/Activity.js
const mongoose = require('mongoose');

const ActivitySchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Activity name is required'],
      unique: true,
      trim: true,
    },
    category: {
      type: String,
      trim: true,
      default: 'General',
    },
    icon: {
      type: String,
      required: [true, 'Icon identifier is required'],
      default: 'account-heart-outline',
    },
    iconFamily: {
      type: String,
      enum: ['MaterialCommunityIcons', 'FontAwesome5', 'Ionicons'],
      default: 'MaterialCommunityIcons',
    },
    description: {
      type: String,
      trim: true,
      default: '',
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model('Activity', ActivitySchema);
