// controllers/interestController.js
const Interest = require('../models/Interest');

const DEFAULT_INTERESTS = [
  {
    name: 'Play',
    category: 'Recreation',
    icon: 'chess-king',
    iconFamily: 'MaterialCommunityIcons',
    description: 'Board games, chess, card games, and trivia',
  },
  {
    name: 'Walk',
    category: 'Physical',
    icon: 'walking',
    iconFamily: 'FontAwesome5',
    description: 'Outdoor walks, park visits, light strolls',
  },
  {
    name: 'Chat',
    category: 'Social',
    icon: 'coffee',
    iconFamily: 'FontAwesome5',
    description: 'Casual conversation, tea time, story sharing',
  },
  {
    name: 'Reading',
    category: 'Hobbies',
    icon: 'book-outline',
    iconFamily: 'Ionicons',
    description: 'Book reading, news discussions, literature',
  },
  {
    name: 'Gardening',
    category: 'Hobbies',
    icon: 'leaf',
    iconFamily: 'MaterialCommunityIcons',
    description: 'Plant care, gardening, flower arranging',
  },
  {
    name: 'Cooking',
    category: 'Hobbies',
    icon: 'silverware-fork-knife',
    iconFamily: 'MaterialCommunityIcons',
    description: 'Culinary activities, baking, recipe sharing',
  },
  {
    name: 'Music',
    category: 'Art & Culture',
    icon: 'musical-notes-outline',
    iconFamily: 'Ionicons',
    description: 'Listening to music, singing, instrumental',
  },
  {
    name: 'Meditation',
    category: 'Wellness',
    icon: 'meditation',
    iconFamily: 'MaterialCommunityIcons',
    description: 'Mindfulness, gentle breathing, relaxation',
  },
  {
    name: 'Art & Craft',
    category: 'Creative',
    icon: 'palette-outline',
    iconFamily: 'MaterialCommunityIcons',
    description: 'Drawing, painting, handicrafts, knitting',
  },
];

// @desc    Get all active interests from database (auto-seeds if empty)
// @route   GET /api/interests
// @access  Public
const getAllInterests = async (req, res) => {
  try {
    let count = await Interest.countDocuments();

    // Auto-seed default interests if none exist in the database table
    if (count === 0) {
      await Interest.insertMany(DEFAULT_INTERESTS);
    }

    const interests = await Interest.find({ isActive: true }).sort({ name: 1 });

    return res.status(200).json({
      success: true,
      count: interests.length,
      data: interests,
    });
  } catch (error) {
    console.error('Error fetching interests:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error fetching interests',
      error: error.message,
    });
  }
};

// @desc    Create a new custom interest
// @route   POST /api/interests
// @access  Private (Admin / Authenticated)
const createInterest = async (req, res) => {
  try {
    const { name, category, icon, iconFamily, description } = req.body;

    if (!name || !icon) {
      return res.status(400).json({
        success: false,
        message: 'Interest name and icon are required',
      });
    }

    const existing = await Interest.findOne({ name: { $regex: new RegExp(`^${name.trim()}$`, 'i') } });
    if (existing) {
      return res.status(409).json({
        success: false,
        message: 'An interest with this name already exists',
      });
    }

    const interest = await Interest.create({
      name: name.trim(),
      category: category || 'General',
      icon: icon.trim(),
      iconFamily: iconFamily || 'MaterialCommunityIcons',
      description: description || '',
      isActive: true,
    });

    return res.status(201).json({
      success: true,
      data: interest,
    });
  } catch (error) {
    console.error('Error creating interest:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error creating interest',
      error: error.message,
    });
  }
};

module.exports = {
  getAllInterests,
  createInterest,
};
