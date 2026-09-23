// middleware/audioUploadMiddleware.js
const multer = require('multer');

const storage = multer.memoryStorage();

const audioFileFilter = (req, file, cb) => {
  const allowedPrefixes = ['audio/', 'video/mp4', 'video/webm', 'video/ogg'];
  const isAllowed =
    allowedPrefixes.some((prefix) => file.mimetype && file.mimetype.startsWith(prefix)) ||
    file.originalname.match(/\.(mp3|m4a|aac|wav|ogg|webm|amr|caf)$/i);

  if (isAllowed) {
    cb(null, true);
  } else {
    cb(new Error('Only audio files are allowed (mp3, m4a, aac, wav, ogg, webm)'), false);
  }
};

const audioUpload = multer({
  storage,
  limits: {
    fileSize: 25 * 1024 * 1024, // 25MB
  },
  fileFilter: audioFileFilter,
});

// Middleware that handles both multipart/form-data and application/json seamlessly
const handleAudioUpload = (req, res, next) => {
  if (req.is('multipart/form-data')) {
    return audioUpload.fields([
      { name: 'audio', maxCount: 1 },
      { name: 'voice', maxCount: 1 },
      { name: 'file', maxCount: 1 },
    ])(req, res, (err) => {
      if (err) {
        return res.status(400).json({ success: false, message: err.message });
      }
      // Normalize req.file to whichever field was uploaded
      if (req.files) {
        req.file = req.files['audio']?.[0] || req.files['voice']?.[0] || req.files['file']?.[0] || null;
      }
      next();
    });
  }
  next();
};

module.exports = { audioUpload, handleAudioUpload };
