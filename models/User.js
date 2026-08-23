// models/User.js
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const sriLankaProvinces = [
  'Western',
  'Central',
  'Southern',
  'Northern',
  'Eastern',
  'North Western',
  'North Central',
  'Uva',
  'Sabaragamuwa',
];

const sriLankaDistricts = [
  'Colombo', 'Gampaha', 'Kalutara', 'Kandy', 'Matale', 'Nuwara Eliya',
  'Galle', 'Matara', 'Hambantota', 'Jaffna', 'Kilinochchi', 'Mannar',
  'Vavuniya', 'Mullaitivu', 'Batticaloa', 'Ampara', 'Trincomalee',
  'Kurunegala', 'Puttalam', 'Anuradhapura', 'Polonnaruwa', 'Badulla',
  'Monaragala', 'Ratnapura', 'Kegalle',
];

const UserSchema = new mongoose.Schema(
  {
    // --- Common Base Attributes ---
    firstName: {
      type: String,
      required: [true, 'First name is required'],
      trim: true,
      match: [/^[A-Za-z]+$/, 'First name can only contain letters (no numbers or symbols)'],
    },
    lastName: {
      type: String,
      required: [true, 'Last name is required'],
      trim: true,
      match: [/^[A-Za-z]+$/, 'Last name can only contain letters (no numbers or symbols)'],
    },
    email: {
      type: String,
      required: [true, 'Email address is required'],
      unique: true,
      lowercase: true,
      trim: true,
      match: [
        /^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/,
        'Please provide a valid email address',
      ],
    },
    password: {
      type: String,
      required: [true, 'Password is required'],
      minlength: [4, 'Password must be at least 4 characters long'],
      select: false,
    },
    phone: {
      type: String,
      required: [true, 'Phone number is required'],
      trim: true,
      match: [
        /^(?:0|94|\+94)?(7[0-9]{8})$/,
        'Please provide a valid Sri Lankan mobile number (e.g. 07XXXXXXXX or +947XXXXXXXX)',
      ],
    },
    role: {
      type: String,
      required: [true, 'Role is required'],
      enum: {
        values: ['elderly', 'volunteer', 'caregiver', 'admin'],
        message: '{VALUE} is not a valid role',
      },
    },
    caregiverType: {
      type: String,
      enum: ['formal_caregiver', 'family_member', null],
      default: null,
    },
    dateOfBirth: {
      type: Date,
      required: [true, 'Date of birth is required'],
    },
    age: {
      type: Number,
      min: [10, 'Age must be at least 10 years'],
      max: [150, 'Age cannot exceed 150 years'],
    },
    address: {
      streetAddress: {
        type: String,
        required: [true, 'Street address is required'],
        trim: true,
      },
      city: {
        type: String,
        required: [true, 'City is required'],
        trim: true,
      },
      postalCode: {
        type: String,
        required: [true, 'Postal code is required'],
        trim: true,
      },
      district: {
        type: String,
        required: [true, 'District is required'],
        enum: sriLankaDistricts,
      },
      province: {
        type: String,
        required: [true, 'Province is required'],
        enum: sriLankaProvinces,
      },
    },
    accountStatus: {
      type: String,
      enum: ['active', 'pending_verification', 'suspended'],
      default: 'pending_verification',
    },
    profilePicture: {
      type: String,
      default: '',
    },
    profilePicturePublicId: {
      type: String,
      default: '',
    },
    interests: {
      type: [String],
      default: ['Play', 'Walk', 'Chat'],
    },

    // --- Role-Specific: Elderly ---
    emergencyContact: {
      name: { type: String, trim: true, default: '' },
      relation: { type: String, trim: true, default: '' },
      phone: {
        type: String,
        trim: true,
        default: '',
        match: [
          /^(?:0|94|\+94)?(7[0-9]{8})?$/,
          'Invalid Sri Lankan emergency phone format',
        ],
      },
    },
    linkedCaregiverId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },

    // --- Role-Specific: Volunteer ---
    volunteerIdType: {
      type: String,
      enum: ['NIC', 'Student ID', 'Passport', null],
      default: null,
    },
    volunteerIdNumber: {
      type: String,
      trim: true,
      default: '',
    },
    educationalInstitution: {
      type: String,
      trim: true,
      default: '',
    },
    verificationBadgeStatus: {
      type: String,
      enum: ['unverified', 'pending', 'verified', 'rejected'],
      default: 'unverified',
    },

    // --- Role-Specific: Caregiver ---
    relationshipToElderly: {
      type: String,
      trim: true,
      default: '',
    },
    organizationName: {
      type: String,
      trim: true,
      default: '',
    },
    linkedElderlyProfiles: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
      },
    ],
  },
  {
    timestamps: true,
  }
);

// Pre-save hook: Hash password and compute age
UserSchema.pre('save', async function () {
  // Calculate age from Date of Birth
  if (this.dateOfBirth) {
    const diff = Date.now() - new Date(this.dateOfBirth).getTime();
    const ageDate = new Date(diff);
    this.age = Math.abs(ageDate.getUTCFullYear() - 1970);

    // Elderly role age enforcement (minimum 40+)
    if (this.role === 'elderly' && this.age < 40) {
      throw new Error('Elderly users must be at least 40 years old');
    }
  }

  // Hash password if modified
  if (!this.isModified('password')) {
    return;
  }

  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
});

// Instance method: Verify entered password
UserSchema.methods.matchPassword = async function (enteredPassword) {
  return await bcrypt.compare(enteredPassword, this.password);
};

module.exports = mongoose.model('User', UserSchema);