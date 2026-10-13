// middleware/evidenceUploadMiddleware.js
const multer = require('multer');
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const cloudinary = require('../config/cloudinary');

const MAX_FILE_SIZE = 4 * 1024 * 1024; // 4MB in bytes for camera pictures
const MAX_PDF_SIZE = 2 * 1024 * 1024; // 2MB in bytes for PDF documents

const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: async (req, file) => {
    const isPdf =
      file.mimetype === 'application/pdf' ||
      (file.originalname && file.originalname.toLowerCase().endsWith('.pdf'));
    return {
      folder: 'togethercare/verification_docs',
      resource_type: isPdf ? 'raw' : 'image',
      public_id: `evidence_${Date.now()}_${Math.round(Math.random() * 1e9)}${isPdf ? '.pdf' : ''}`,
    };
  },
});

const fileFilter = (req, file, cb) => {
  const isPdf =
    file.mimetype === 'application/pdf' ||
    (file.originalname && file.originalname.toLowerCase().endsWith('.pdf'));
  const isImage =
    ['image/jpeg', 'image/png', 'image/jpg', 'image/webp'].includes(file.mimetype) ||
    (file.originalname && file.originalname.toLowerCase().match(/\.(jpg|jpeg|png|webp)$/i));

  if (isPdf || isImage) {
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

// Middleware to handle evidence upload with 4MB image and 2MB PDF validation
const handleEvidenceUpload = (req, res, next) => {
  if (!req.is('multipart/form-data')) {
    return next();
  }

  uploadEvidence.array('evidenceFiles', 5)(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({
          status: 'fail',
          message: 'Validation failed: Image cannot exceed 4MB and PDF cannot exceed 2MB in size.',
        });
      }
      return res.status(400).json({ status: 'fail', message: err.message });
    } else if (err) {
      return res.status(400).json({ status: 'fail', message: err.message });
    }

    // Explicitly validate PDF file size does not exceed 2MB
    if (req.files && req.files.length > 0) {
      for (const file of req.files) {
        const isPdf =
          file.mimetype === 'application/pdf' ||
          (file.originalname && file.originalname.toLowerCase().endsWith('.pdf'));
        if (isPdf && file.size && file.size > MAX_PDF_SIZE) {
          return res.status(400).json({
            status: 'fail',
            message: 'Validation failed: The selected PDF exceeds the 2MB limit. Please choose a smaller file.',
          });
        }
      }
    }

    next();
  });
};

module.exports = { handleEvidenceUpload };

