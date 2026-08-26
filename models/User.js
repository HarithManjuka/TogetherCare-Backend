// models/User.js
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const sriLankaProvinces = [
  'Western', 'Central', 'Southern', 'Northern', 'Eastern',
  'North Western', 'North Central', 'Uva', 'Sabaragamuwa',
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
    // Human-readable Unique ID (8 characters: e.g. VOL-0001)
    customId: {
      type: String,
      unique: true,
      index: true,
      trim: true,
    },
    firstName: {
      type: String,
      required: [true, 'First name is required'],
      trim: true,
      match: [/^[A-Za-z]+$/, 'First name can only contain letters'],
    },
    lastName: {
      type: String,
      required: [true, 'Last name is required'],
      trim: true,
      match: [/^[A-Za-z]+$/, 'Last name can only contain letters'],
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
        'Please provide a valid Sri Lankan mobile number',
      ],
    },
    role: {
      type: String,
      required: [true, 'Role is required'],
      enum: ['elderly', 'volunteer', 'caregiver', 'admin'],
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
      min: 10,
      max: 150,
    },
    address: {
      streetAddress: { type: String, required: true, trim: true },
      city: { type: String, required: true, trim: true },
      postalCode: { type: String, required: true, trim: true },
      district: { type: String, required: true, enum: sriLankaDistricts },
      province: { type: String, required: true, enum: sriLankaProvinces },
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

    // Password reset fields
    resetPasswordOtpHash: {
      type: String,
      select: false,
    },
    resetPasswordOtpExpires: {
      type: Date,
      select: false,
    },
    passwordResetSessionToken: {
      type: String,
      select: false,
    },

    // Email Verification Fields
    isEmailVerified: {
      type: Boolean,
      default: false,
    },
    emailVerificationOtpHash: {
      type: String,
      select: false,
    },
    emailVerificationOtpExpires: {
      type: Date,
      select: false,
    },

    // Elderly specific
    emergencyContact: {
      name: { type: String, default: '' },
      relation: { type: String, default: '' },
      phone: { type: String, default: '' },
    },
    linkedCaregiverId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },

    // Volunteer specific
    volunteerIdType: {
      type: String,
      enum: ['NIC', 'Student ID', 'Passport', null],
      default: null,
    },
    volunteerIdNumber: { type: String, default: '' },
    educationalInstitution: { type: String, default: '' },
    verificationBadgeStatus: {
      type: String,
      enum: ['unverified', 'pending', 'verified', 'rejected'],
      default: 'unverified',
    },

    // Caregiver specific
    relationshipToElderly: { type: String, default: '' },
    organizationName: { type: String, default: '' },
    linkedElderlyProfiles: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  },
  {
    timestamps: true,
  }
);

// Helper to calculate exact age dynamically based on current date and DOB
const calculateExactAge = (dob) => {
  if (!dob) return null;
  const today = new Date();
  const birthDate = new Date(dob);
  let age = today.getFullYear() - birthDate.getFullYear();
  const monthDiff = today.getMonth() - birthDate.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
    age--;
  }
  return Math.max(0, age);
};

// Virtual property for real-time age computation
UserSchema.virtual('currentAge').get(function () {
  return calculateExactAge(this.dateOfBirth) || this.age;
});

// Pre-save hook: Hash password and compute age
UserSchema.pre('save', async function () {
  if (this.dateOfBirth) {
    this.age = calculateExactAge(this.dateOfBirth);

    if (this.role === 'elderly' && this.age < 40) {
      throw new Error('Elderly users must be at least 40 years old');
    }
  }

  if (!this.isModified('password')) {
    return;
  }

  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
});

UserSchema.methods.matchPassword = async function (enteredPassword) {
  return await bcrypt.compare(enteredPassword, this.password);
};

module.exports = mongoose.model('User', UserSchema);