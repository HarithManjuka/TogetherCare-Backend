// middleware/uploadMiddleware.js
const multer = require('multer');

const storage = multer.memoryStorage();

const fileFilter = (req, file, cb) => {
  if (file.mimetype && file.mimetype.startsWith('image/')) {
    cb(null, true);
  } else {
    cb(new Error('Only image files are allowed (jpeg, png, webp, etc.)'), false);
  }
};

const upload = multer({
  storage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB
  },
  fileFilter,
});

// Middleware that handles both multipart/form-data and application/json seamlessly
const handleUpload = (req, res, next) => {
  if (req.is('multipart/form-data')) {
    return upload.single('profilePicture')(req, res, (err) => {
      if (err) {
        return res.status(400).json({ success: false, message: err.message });
      }
      next();
    });
  }
  next();
};

module.exports = { upload, handleUpload };
