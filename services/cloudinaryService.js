// services/cloudinaryService.js
const { Readable } = require('stream');
const cloudinary = require('../config/cloudinary');

const USER_PROFILE_FOLDER = 'togethercare/user_profile';

/**
 * Upload profile picture buffer to Cloudinary under 'togethercare/user_profile'
 * @param {Buffer} buffer - File buffer from Multer
 * @returns {Promise<Object>} Cloudinary upload result object
 */
const uploadBufferToCloudinary = (buffer) => {
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder: USER_PROFILE_FOLDER,
        resource_type: 'image',
        transformation: [
          { width: 500, height: 500, crop: 'fill', gravity: 'face' },
          { quality: 'auto', fetch_format: 'auto' },
        ],
      },
      (error, result) => {
        if (error) return reject(error);
        resolve(result);
      }
    );

    Readable.from(buffer).pipe(uploadStream);
  });
};

/**
 * Upload base64 image data string to Cloudinary under 'togethercare/user_profile'
 * @param {string} base64Data - Base64 Data URI or raw base64 string
 * @returns {Promise<Object>} Cloudinary upload result object
 */
const uploadBase64ToCloudinary = async (base64Data) => {
  return await cloudinary.uploader.upload(base64Data, {
    folder: USER_PROFILE_FOLDER,
    resource_type: 'image',
    transformation: [
      { width: 500, height: 500, crop: 'fill', gravity: 'face' },
      { quality: 'auto', fetch_format: 'auto' },
    ],
  });
};

/**
 * Main service method to upload user profile picture (Buffer or Base64)
 * @param {Object} params
 * @param {Buffer} [params.buffer]
 * @param {string} [params.base64Data]
 * @returns {Promise<Object>} Cloudinary upload result
 */
const uploadUserProfilePicture = async ({ buffer, base64Data }) => {
  if (buffer) {
    return await uploadBufferToCloudinary(buffer);
  } else if (base64Data) {
    return await uploadBase64ToCloudinary(base64Data);
  }
  throw new Error('No image buffer or base64 data provided');
};

/**
 * Delete user profile picture from Cloudinary by public ID
 * @param {string} publicId - Cloudinary public ID of the image
 * @returns {Promise<Object>} Cloudinary deletion result
 */
const deleteUserProfilePicture = async (publicId) => {
  if (!publicId) return null;
  try {
    return await cloudinary.uploader.destroy(publicId);
  } catch (error) {
    console.warn(`[CloudinaryService] Failed to delete image ${publicId}:`, error.message);
    return null;
  }
};

module.exports = {
  USER_PROFILE_FOLDER,
  uploadUserProfilePicture,
  deleteUserProfilePicture,
};
