// utils/customIdGenerator.js
const Counter = require('../models/Counter');

const ROLE_PREFIXES = {
  elderly: 'ELD',
  volunteer: 'VOL',
  caregiver: 'CGV',
  admin: 'ADM',
  request: 'REQ',
};

/**
 * Generates an 8-character human-friendly Unique ID (e.g., VOL-0001, ELD-1042)
 * Wrapped with error handling to prevent unhandled promise rejections on DB timeouts.
 * @param {string} role - 'elderly' | 'volunteer' | 'caregiver' | 'admin' | 'request'
 * @returns {Promise<string>} - 8-character custom user/request ID
 */
const generateHumanReadableId = async (role) => {
  try {
    const prefix = ROLE_PREFIXES[role] || (role ? role.substring(0, 3).toUpperCase() : 'USR');
    const counterId = `userId_${role}`;

    // Atomically increment the sequence counter for this specific role/type
    const counter = await Counter.findByIdAndUpdate(
      counterId,
      { $inc: { seq: 1 } },
      { returnDocument: 'after', upsert: true }
    );

    if (!counter || typeof counter.seq !== 'number') {
      throw new Error(`Invalid counter state returned for '${counterId}'`);
    }

    // Zero-pad to 4 digits (e.g., 1 -> '0001', 42 -> '0042')
    const formattedSeq = String(counter.seq).padStart(4, '0');

    // Format: PREFIX(3) + HYPHEN(1) + DIGITS(4) = 8 characters
    return `${prefix}-${formattedSeq}`;
  } catch (error) {
    console.error(`[customIdGenerator Error] Sequence allocation failed for role '${role}':`, error.message);
    throw new Error(`Failed to allocate custom sequence ID for role '${role}': ${error.message}`);
  }
};

module.exports = { generateHumanReadableId };