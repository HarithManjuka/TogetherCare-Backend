// routes/messageRoutes.js
const express = require('express');
const router = express.Router();
const {
  getConversations,
  getMessages,
  sendMessage,
  markThreadRead,
  searchContactByPhone,
  addContact,
  getContacts,
  removeContact,
  uploadAudio,
} = require('../controllers/messageController');
const { protect } = require('../middleware/authMiddleware');
const { handleAudioUpload } = require('../middleware/audioUploadMiddleware');

router.use(protect);

// Voice audio upload
router.post('/upload-audio', handleAudioUpload, uploadAudio);

// Conversations & Contacts
router.get('/conversations', getConversations);
router.get('/contacts/search', searchContactByPhone);
router.get('/contacts', getContacts);
router.post('/contacts', addContact);
router.delete('/contacts/:contactUserId', removeContact);

// Messages thread & actions
router.get('/:otherUserId', getMessages);
router.post('/', sendMessage);
router.patch('/:otherUserId/read', markThreadRead);

module.exports = router;
