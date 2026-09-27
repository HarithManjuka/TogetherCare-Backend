// middleware/evidenceUploadMiddleware.js
const multer = require('multer');
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const cloudinary = require('../config/cloudinary');

const MAX_FILE_SIZE = 2 * 1024 * 1024; // 2MB in bytes
const ALLOWED_MIME_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/jpg',
  'image/webp',
];

const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: async (req, file) => {
    const isPdf = file.mimetype === 'application/pdf';
    return {
      folder: 'togethercare/verification_docs',
      resource_type: isPdf ? 'raw' : 'image',
      public_id: `evidence_${Date.now()}_${Math.round(Math.random() * 1e9)}${isPdf ? '.pdf' : ''}`,
    };
  },
});

const fileFilter = (req, file, cb) => {
  if (ALLOWED_MIME_TYPES.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Invalid format. Only PDF and pictures (JPG, PNG, WEBP) are allowed.'), false);
  }
};

const uploadEvidence = multer({
  storage,
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter,
});

// Wrapper to handle Multer 2MB size limit error gracefully with clean JSON response
const handleEvidenceUpload = (req, res, next) => {
  uploadEvidence.array('evidenceFiles', 5)(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({
          status: 'fail',
          message: 'Validation failed: Single file or PDF cannot exceed 2MB in size.',
        });
      }
      return res.status(400).json({ status: 'fail', message: err.message });
    } else if (err) {
      return res.status(400).json({ status: 'fail', message: err.message });
    }
    next();
  });
};

module.exports = { handleEvidenceUpload };
