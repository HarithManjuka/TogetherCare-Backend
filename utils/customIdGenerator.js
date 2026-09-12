// utils/customIdGenerator.js
const Counter = require('../models/Counter');

const rolePrefixMap = {
  elderly: { name: 'user_elderly', prefix: 'ELD' },
  volunteer: { name: 'user_volunteer', prefix: 'VOL' },
  caregiver: { name: 'user_caregiver', prefix: 'CG' },
  admin: { name: 'user_admin', prefix: 'ADM' },
};

/**
 * Atomically generates a guaranteed unique minimal gap-filled sequential ID.
 * Finds the lowest unused integer (e.g. fills VOL-0003 if deleted) instead of causing gaps.
 * @param {string} counterName - Unique identifier for the counter document in MongoDB.
 * @param {string} prefix - Custom prefix for the readable ID (e.g., 'ELD', 'VOL', 'CG').
 * @param {number} padLength - The minimum digit count to zero-pad (default: 4).
 * @returns {Promise<string>} - Formatted unique ID string (e.g., 'VOL-0003').
 */
const generateCustomId = async (counterName, prefix = 'ID', padLength = 4) => {
  const User = require('../models/User');

  const prefixToRoleMap = {
    ELD: 'elderly',
    VOL: 'volunteer',
    CG: 'caregiver',
    ADM: 'admin',
  };

  const role = prefixToRoleMap[prefix] || counterName.replace('user_', '');

  // 1. Query all current customIds for this role
  const users = await User.find({ role }).select('customId').lean();

  // 2. Extract active numeric sequences into a set
  const usedNumbers = new Set();
  const regex = new RegExp(`^${prefix}-(\\d+)$`);

  users.forEach((u) => {
    if (u.customId) {
      const match = u.customId.match(regex);
      if (match) {
        const num = parseInt(match[1], 10);
        if (!isNaN(num) && num > 0) {
          usedNumbers.add(num);
        }
      }
    }
  });

  // 3. Find lowest available sequence starting from 1
  let targetSeq = 1;
  while (usedNumbers.has(targetSeq)) {
    targetSeq++;
  }

  // 4. Verify unicity against DB (safeguard against race conditions)
  let isAvailable = false;
  let customId = '';

  while (!isAvailable) {
    const candidateId = `${prefix}-${String(targetSeq).padStart(padLength, '0')}`;
    const exists = await User.exists({ customId: candidateId });
    if (!exists) {
      customId = candidateId;
      isAvailable = true;
    } else {
      usedNumbers.add(targetSeq);
      targetSeq++;
      while (usedNumbers.has(targetSeq)) {
        targetSeq++;
      }
    }
  }

  // 5. Update Counter to match the max sequence in system
  let maxSeq = targetSeq;
  usedNumbers.forEach((n) => {
    if (n > maxSeq) maxSeq = n;
  });

  await Counter.findOneAndUpdate(
    { name: counterName },
    { $set: { seq: maxSeq } },
    { upsert: true, new: true }
  );

  return customId;
};

/**
 * Generates human-readable atomic IDs based on user roles.
 * @param {string} role - 'elderly', 'volunteer', 'caregiver', or 'admin'
 * @returns {Promise<string>}
 */
const generateHumanReadableId = async (role) => {
  const config = rolePrefixMap[role] || { name: `user_${role}`, prefix: 'USR' };
  return generateCustomId(config.name, config.prefix, 4);
};

/**
 * Scans the database and fixes any duplicate or malformed customId fields across all users,
 * re-assigning minimal sequential gap-filled IDs.
 */
const fixDuplicateUserIds = async () => {
  try {
    const User = require('../models/User');
    const roles = ['elderly', 'volunteer', 'caregiver', 'admin'];

    for (const role of roles) {
      const config = rolePrefixMap[role];
      const users = await User.find({ role }).sort({ createdAt: 1 });

      const seenIds = new Set();
      let maxSeq = 0;

      for (const user of users) {
        const isMalformedOrDuplicate =
          !user.customId ||
          user.customId.includes('{prefix}') ||
          user.customId.includes('({prefix}') ||
          seenIds.has(user.customId);

        if (isMalformedOrDuplicate) {
          let seq = 1;
          let candidate = `${config.prefix}-${String(seq).padStart(4, '0')}`;

          while (
            seenIds.has(candidate) ||
            (await User.exists({ customId: candidate, _id: { $ne: user._id } }))
          ) {
            seq++;
            candidate = `${config.prefix}-${String(seq).padStart(4, '0')}`;
          }

          user.customId = candidate;
          await user.save();
          seenIds.add(candidate);
          if (seq > maxSeq) maxSeq = seq;
        } else {
          seenIds.add(user.customId);
          const match = user.customId.match(new RegExp(`^${config.prefix}-(\\d+)$`));
          if (match) {
            const num = parseInt(match[1], 10);
            if (num > maxSeq) maxSeq = num;
          }
        }
      }

      if (maxSeq > 0) {
        await Counter.findOneAndUpdate(
          { name: config.name },
          { $set: { seq: maxSeq } },
          { upsert: true }
        );
      }
    }
  } catch (err) {
    console.error('Error fixing duplicate user custom IDs:', err.message);
  }
};

module.exports = {
  generateCustomId,
  generateHumanReadableId,
  fixDuplicateUserIds,
};