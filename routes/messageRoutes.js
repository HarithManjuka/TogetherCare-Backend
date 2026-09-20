// routes/messageRoutes.js
const express = require('express');
const router = express.Router();
const {
  getConversations,
  getMessages,
  sendMessage,
  markThreadRead,
} = require('../controllers/messageController');
const { protect } = require('../middleware/authMiddleware');

router.use(protect);

router.get('/conversations', getConversations);
router.get('/:otherUserId', getMessages);
router.post('/', sendMessage);
router.patch('/:otherUserId/read', markThreadRead);

module.exports = router;
