// controllers/activityController.js
const Activity = require('../models/Activity');

const DEFAULT_ACTIVITIES = [
  {
    name: 'Grocery',
    category: 'Essential',
    icon: 'shopping',
    iconFamily: 'MaterialCommunityIcons',
    description: 'Grocery shopping, market runs, food essentials',
  },
  {
    name: 'Medicine',
    category: 'Healthcare',
    icon: 'pill',
    iconFamily: 'MaterialCommunityIcons',
    description: 'Pharmacy visits, medicine pickup, health supplies',
  },
  {
    name: 'Tech',
    category: 'Assistance',
    icon: 'laptop',
    iconFamily: 'MaterialCommunityIcons',
    description: 'Smartphone help, computer guidance, online errands',
  },
  {
    name: 'Work',
    category: 'Assistance',
    icon: 'wrench',
    iconFamily: 'MaterialCommunityIcons',
    description: 'Minor house repairs, fixing items, light handywork',
  },
  {
    name: 'Walk',
    category: 'Physical',
    icon: 'walking',
    iconFamily: 'FontAwesome5',
    description: 'Outdoor strolls, fresh air walking, exercise companionship',
  },
  {
    name: 'Chat',
    category: 'Social',
    icon: 'coffee',
    iconFamily: 'FontAwesome5',
    description: 'Friendly conversations, tea/coffee time, storytelling',
  },
  {
    name: 'Game',
    category: 'Recreation',
    icon: 'chess-pawn',
    iconFamily: 'FontAwesome5',
    description: 'Board games, chess, card games, mental puzzles',
  },
  {
    name: 'Reading',
    category: 'Hobbies',
    icon: 'book-open-page-variant-outline',
    iconFamily: 'MaterialCommunityIcons',
    description: 'Book reading, newspaper reading, literary discussions',
  },
  {
    name: 'Gardening',
    category: 'Hobbies',
    icon: 'leaf',
    iconFamily: 'MaterialCommunityIcons',
    description: 'Planting, watering, garden maintenance, floral care',
  },
  {
    name: 'Cooking',
    category: 'Hobbies',
    icon: 'silverware-fork-knife',
    iconFamily: 'MaterialCommunityIcons',
    description: 'Light cooking, recipe sharing, meal preparation',
  },
];

// @desc    Get all active activities from database (auto-seeds if empty)
// @route   GET /api/activities
// @access  Public / Authenticated
const getAllActivities = async (req, res) => {
  try {
    let count = await Activity.countDocuments();

    // Auto-seed default activities if none exist in the database table
    if (count === 0) {
      await Activity.insertMany(DEFAULT_ACTIVITIES);
    }

    const activities = await Activity.find({ isActive: true }).sort({ createdAt: 1 });

    return res.status(200).json({
      success: true,
      count: activities.length,
      data: activities,
    });
  } catch (error) {
    console.error('Error fetching activities:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error fetching activities',
      error: error.message,
    });
  }
};

// @desc    Create a new custom activity
// @route   POST /api/activities
// @access  Private (Admin / Authenticated)
const createActivity = async (req, res) => {
  try {
    const { name, category, icon, iconFamily, description } = req.body;

    if (!name || !icon) {
      return res.status(400).json({
        success: false,
        message: 'Activity name and icon are required',
      });
    }

    const existing = await Activity.findOne({ name: { $regex: new RegExp(`^${name.trim()}$`, 'i') } });
    if (existing) {
      return res.status(409).json({
        success: false,
        message: 'An activity with this name already exists',
      });
    }

    const activity = await Activity.create({
      name: name.trim(),
      category: category || 'General',
      icon: icon.trim(),
      iconFamily: iconFamily || 'MaterialCommunityIcons',
      description: description || '',
      isActive: true,
    });

    return res.status(201).json({
      success: true,
      data: activity,
    });
  } catch (error) {
    console.error('Error creating activity:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error creating activity',
      error: error.message,
    });
  }
};

module.exports = {
  getAllActivities,
  createActivity,
};
