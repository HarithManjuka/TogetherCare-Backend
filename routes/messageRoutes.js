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
} = require('../controllers/messageController');
const { protect } = require('../middleware/authMiddleware');

router.use(protect);

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
