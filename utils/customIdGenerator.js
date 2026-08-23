// utils/customIdGenerator.js
const Counter = require('../models/Counter');

const ROLE_PREFIXES = {
  elderly: 'ELD',
  volunteer: 'VOL',
  caregiver: 'CGV',
  admin: 'ADM',
};

/**
 * Generates an 8-character human-friendly Unique ID (e.g., VOL-0001, ELD-1042)
 * @param {string} role - 'elderly' | 'volunteer' | 'caregiver' | 'admin'
 * @returns {Promise<string>} - 8-character custom user ID
 */
const generateHumanReadableId = async (role) => {
  const prefix = ROLE_PREFIXES[role] || 'USR';
  const counterId = `userId_${role}`;

  // Atomically increment the sequence counter for this specific role
  const counter = await Counter.findByIdAndUpdate(
    counterId,
    { $inc: { seq: 1 } },
    { returnDocument: 'after', upsert: true }
  );

  // Zero-pad to 4 digits (e.g., 1 -> '0001', 42 -> '0042')
  const formattedSeq = String(counter.seq).padStart(4, '0');

  // Format: PREFIX(3) + HYPHEN(1) + DIGITS(4) = 8 characters
  return `${prefix}-${formattedSeq}`;
};

module.exports = { generateHumanReadableId };