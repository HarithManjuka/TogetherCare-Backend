// controllers/messageController.js
const Message = require('../models/Message');
const User = require('../models/User');
const { createNotification } = require('./notificationController');
const { getIO } = require('../socket');

/**
 * Helper to normalize Sri Lankan phone numbers to 9-digit suffix (e.g. 771234567)
 */
const normalizePhoneSuffix = (phoneStr) => {
  if (!phoneStr) return null;
  const digits = phoneStr.replace(/[^0-9]/g, '');
  if (digits.length >= 9) {
    return digits.slice(-9);
  }
  return digits;
};

// @desc    Get all conversations for logged-in user
// @route   GET /api/messages/conversations
// @access  Private
const getConversations = async (req, res) => {
  try {
    const userId = req.user._id;

    // Find all messages involving the logged-in user
    const messages = await Message.find({
      $or: [{ sender: userId }, { recipient: userId }],
    })
      .sort({ createdAt: -1 })
      .populate('sender', 'firstName lastName role profilePicture customId phone')
      .populate('recipient', 'firstName lastName role profilePicture customId phone')
      .populate('relatedSenior', 'firstName lastName customId');

    // Group by other user
    const conversationMap = new Map();

    for (const msg of messages) {
      const otherUser =
        msg.sender._id.toString() === userId.toString() ? msg.recipient : msg.sender;

      if (!otherUser || !otherUser._id) continue;
      const otherId = otherUser._id.toString();

      if (!conversationMap.has(otherId)) {
        const unreadCount =
          msg.recipient._id.toString() === userId.toString() && !msg.isRead ? 1 : 0;

        conversationMap.set(otherId, {
          otherUser,
          lastMessage: {
            _id: msg._id,
            text: msg.text,
            messageType: msg.messageType,
            audioDuration: msg.audioDuration,
            createdAt: msg.createdAt,
            senderId: msg.sender._id,
            isRead: msg.isRead,
          },
          relatedSenior: msg.relatedSenior,
          unreadCount,
        });
      } else {
        // Count unread
        if (msg.recipient._id.toString() === userId.toString() && !msg.isRead) {
          const convo = conversationMap.get(otherId);
          convo.unreadCount += 1;
        }
      }
    }

    const conversations = Array.from(conversationMap.values());

    res.status(200).json({
      success: true,
      count: conversations.length,
      data: conversations,
    });
  } catch (error) {
    console.error('Get Conversations Error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while fetching conversations',
      error: error.message,
    });
  }
};

// @desc    Get message thread between logged-in user and another user
// @route   GET /api/messages/:otherUserId
// @access  Private
const getMessages = async (req, res) => {
  try {
    const userId = req.user._id;
    const { otherUserId } = req.params;

    const messages = await Message.find({
      $or: [
        { sender: userId, recipient: otherUserId },
        { sender: otherUserId, recipient: userId },
      ],
    })
      .populate('sender', 'firstName lastName role profilePicture customId phone')
      .populate('recipient', 'firstName lastName role profilePicture customId phone')
      .populate('relatedSenior', 'firstName lastName customId')
      .sort({ createdAt: 1 });

    // Mark unread messages sent to me as read
    const updateResult = await Message.updateMany(
      { sender: otherUserId, recipient: userId, isRead: false },
      { isRead: true }
    );

    if (updateResult && updateResult.modifiedCount > 0) {
      try {
        const io = getIO();
        if (io) {
          io.to(`user_${otherUserId}`).emit('messages_read', {
            readBy: userId.toString(),
          });
          io.to(`user_${userId}`).emit('messages_read', {
            readBy: userId.toString(),
            threadWith: otherUserId.toString(),
          });
        }
      } catch (socketErr) {
        console.warn('Socket read broadcast warning in getMessages:', socketErr.message);
      }
    }

    const formattedMessages = messages.map((m) => {
      const obj = m.toObject ? m.toObject() : { ...m };
      obj.content = obj.text;
      obj.durationSeconds = obj.audioDuration;
      return obj;
    });

    res.status(200).json({
      success: true,
      count: formattedMessages.length,
      data: formattedMessages,
    });
  } catch (error) {
    console.error('Get Messages Error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while fetching messages',
      error: error.message,
    });
  }
};

// @desc    Send a message (text or voice)
// @route   POST /api/messages
// @access  Private
const sendMessage = async (req, res) => {
  try {
    const senderId = req.user._id;
    const {
      recipientId,
      relatedSeniorId,
      messageType,
      text,
      content,
      audioUrl,
      audioDuration,
      durationSeconds,
    } = req.body;

    const messageText = (text || content || '').trim();
    const duration =
      audioDuration !== undefined
        ? audioDuration
        : durationSeconds !== undefined
        ? durationSeconds
        : 0;

    if (!recipientId) {
      return res.status(400).json({
        success: false,
        message: 'Recipient ID is required',
      });
    }

    if (messageType === 'voice' && !audioUrl && !messageText) {
      return res.status(400).json({
        success: false,
        message: 'Voice message audio content is required',
      });
    }

    if ((!messageType || messageType === 'text') && !messageText) {
      return res.status(400).json({
        success: false,
        message: 'Message text is required',
      });
    }

    const recipient = await User.findById(recipientId);
    if (!recipient) {
      return res.status(404).json({
        success: false,
        message: 'Recipient user not found',
      });
    }

    const message = await Message.create({
      sender: senderId,
      recipient: recipientId,
      relatedSenior: relatedSeniorId || null,
      messageType: messageType || 'text',
      text: messageText || (messageType === 'voice' ? '🎤 Voice Message' : ''),
      audioUrl: audioUrl || '',
      audioDuration: duration,
      isRead: false,
    });

    const populatedMessage = await Message.findById(message._id)
      .populate('sender', 'firstName lastName role profilePicture customId phone')
      .populate('recipient', 'firstName lastName role profilePicture customId phone')
      .populate('relatedSenior', 'firstName lastName customId');

    // Notify recipient
    const senderName = `${req.user.firstName} ${req.user.lastName || ''}`.trim();
    const notifSnippet =
      messageType === 'voice' ? '🎤 Sent you a voice message' : messageText.slice(0, 60);

    await createNotification({
      recipient: recipientId,
      sender: senderId,
      senior: relatedSeniorId || null,
      type: 'message',
      title: `Message from ${senderName}`,
      message: notifSnippet,
      data: { messageId: message._id, senderId },
    });

    const responseData = populatedMessage.toObject
      ? populatedMessage.toObject()
      : { ...populatedMessage };
    responseData.content = responseData.text;
    responseData.durationSeconds = responseData.audioDuration;

    // Real-time socket broadcast
    try {
      const io = getIO();
      if (io) {
        io.to(`user_${recipientId}`).emit('receive_message', responseData);
        io.to(`user_${senderId}`).emit('receive_message', responseData);
        const threadRoom = [senderId.toString(), recipientId.toString()].sort().join('_');
        io.to(`thread_${threadRoom}`).emit('receive_message', responseData);
      }
    } catch (socketErr) {
      console.warn('Socket broadcast warning:', socketErr.message);
    }

    res.status(201).json({
      success: true,
      message: 'Message sent successfully',
      data: responseData,
    });
  } catch (error) {
    console.error('Send Message Error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while sending message',
      error: error.message,
    });
  }
};

// @desc    Mark all messages in thread as read
// @route   PATCH /api/messages/:otherUserId/read
// @access  Private
const markThreadRead = async (req, res) => {
  try {
    const userId = req.user._id;
    const { otherUserId } = req.params;

    await Message.updateMany(
      { sender: otherUserId, recipient: userId, isRead: false },
      { isRead: true }
    );

    // Notify other user and reader via socket
    try {
      const io = getIO();
      if (io) {
        io.to(`user_${otherUserId}`).emit('messages_read', {
          readBy: userId.toString(),
        });
        io.to(`user_${userId}`).emit('messages_read', {
          readBy: userId.toString(),
          threadWith: otherUserId.toString(),
        });
      }
    } catch (socketErr) {
      console.warn('Socket read broadcast warning:', socketErr.message);
    }

    res.status(200).json({
      success: true,
      message: 'Thread marked as read',
    });
  } catch (error) {
    console.error('Mark Thread Read Error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while updating read status',
      error: error.message,
    });
  }
};

// ==========================================
// CONTACT MANAGEMENT CONTROLLERS
// ==========================================

// @desc    Search registered user by mobile phone number
// @route   GET /api/messages/contacts/search
// @access  Private
const searchContactByPhone = async (req, res) => {
  try {
    const { phone } = req.query;

    if (!phone || phone.trim().length < 7) {
      return res.status(400).json({
        success: false,
        message: 'Please provide a valid mobile number (e.g. 0771234567 or +94771234567)',
      });
    }

    const phoneSuffix = normalizePhoneSuffix(phone.trim());
    if (!phoneSuffix) {
      return res.status(400).json({
        success: false,
        message: 'Invalid phone number format',
      });
    }

    const possiblePhones = [
      phoneSuffix,
      `0${phoneSuffix}`,
      `94${phoneSuffix}`,
      `+94${phoneSuffix}`,
    ];

    const foundUser = await User.findOne({
      $or: [
        { phone: { $in: possiblePhones } },
        { phone: { $regex: phoneSuffix + '$' } },
      ],
    }).select('_id firstName lastName phone role profilePicture customId');

    if (!foundUser) {
      return res.status(404).json({
        success: false,
        message: `No registered user found with mobile number ending in ${phoneSuffix}`,
      });
    }

    if (foundUser._id.toString() === req.user._id.toString()) {
      return res.status(400).json({
        success: false,
        message: 'You cannot add your own mobile number as a contact',
      });
    }

    // Check if already in user's contacts
    const currentUser = await User.findById(req.user._id);
    const isAlreadyContact = (currentUser.contacts || []).some(
      (c) => c.user && c.user.toString() === foundUser._id.toString()
    );

    res.status(200).json({
      success: true,
      data: {
        ...foundUser.toObject(),
        isAlreadyContact,
      },
    });
  } catch (error) {
    console.error('Search Contact Error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while searching contact',
      error: error.message,
    });
  }
};

// @desc    Add a contact by mobile number or user ID
// @route   POST /api/messages/contacts
// @access  Private
const addContact = async (req, res) => {
  try {
    const { phone, contactUserId, nickname } = req.body;

    let targetUser = null;

    if (contactUserId) {
      targetUser = await User.findById(contactUserId).select(
        '_id firstName lastName phone role profilePicture customId'
      );
    } else if (phone) {
      const phoneSuffix = normalizePhoneSuffix(phone.trim());
      if (!phoneSuffix) {
        return res.status(400).json({
          success: false,
          message: 'Invalid phone number format',
        });
      }
      const possiblePhones = [
        phoneSuffix,
        `0${phoneSuffix}`,
        `94${phoneSuffix}`,
        `+94${phoneSuffix}`,
      ];
      targetUser = await User.findOne({
        $or: [
          { phone: { $in: possiblePhones } },
          { phone: { $regex: phoneSuffix + '$' } },
        ],
      }).select('_id firstName lastName phone role profilePicture customId');
    } else {
      return res.status(400).json({
        success: false,
        message: 'Please provide either a mobile number or contact user ID',
      });
    }

    if (!targetUser) {
      return res.status(404).json({
        success: false,
        message: 'User not found with the provided details',
      });
    }

    if (targetUser._id.toString() === req.user._id.toString()) {
      return res.status(400).json({
        success: false,
        message: 'You cannot add yourself as a contact',
      });
    }

    const currentUser = await User.findById(req.user._id);
    if (!currentUser.contacts) {
      currentUser.contacts = [];
    }

    const alreadyExists = currentUser.contacts.some(
      (c) => c.user && c.user.toString() === targetUser._id.toString()
    );

    if (alreadyExists) {
      return res.status(400).json({
        success: false,
        message: `${targetUser.firstName} is already in your contacts list`,
      });
    }

    currentUser.contacts.push({
      user: targetUser._id,
      nickname: (nickname || '').trim(),
      addedAt: new Date(),
    });

    await currentUser.save();

    res.status(201).json({
      success: true,
      message: `${targetUser.firstName} added to your contacts successfully`,
      data: {
        _id: targetUser._id,
        user: targetUser,
        nickname: (nickname || '').trim(),
      },
    });
  } catch (error) {
    console.error('Add Contact Error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while adding contact',
      error: error.message,
    });
  }
};

// @desc    Get user's contact list (saved contacts + linked dependents/caregiver)
// @route   GET /api/messages/contacts
// @access  Private
const getContacts = async (req, res) => {
  try {
    const user = await User.findById(req.user._id)
      .populate('contacts.user', 'firstName lastName role profilePicture customId phone')
      .populate('linkedElderlyProfiles', 'firstName lastName role profilePicture customId phone')
      .populate('linkedCaregiverId', 'firstName lastName role profilePicture customId phone');

    const contactMap = new Map();

    // 1. Add explicitly saved contacts
    if (user.contacts && user.contacts.length > 0) {
      for (const c of user.contacts) {
        if (c.user && c.user._id) {
          const uObj = c.user.toObject ? c.user.toObject() : c.user;
          contactMap.set(uObj._id.toString(), {
            _id: uObj._id,
            firstName: uObj.firstName,
            lastName: uObj.lastName,
            role: uObj.role,
            phone: uObj.phone,
            profilePicture: uObj.profilePicture,
            customId: uObj.customId,
            nickname: c.nickname || '',
            isSavedContact: true,
            addedAt: c.addedAt,
          });
        }
      }
    }

    // 2. Add linked elderly profiles (for caregivers)
    if (user.linkedElderlyProfiles && user.linkedElderlyProfiles.length > 0) {
      for (const e of user.linkedElderlyProfiles) {
        if (e && e._id) {
          const eObj = e.toObject ? e.toObject() : e;
          const key = eObj._id.toString();
          if (!contactMap.has(key)) {
            contactMap.set(key, {
              _id: eObj._id,
              firstName: eObj.firstName,
              lastName: eObj.lastName,
              role: 'elderly',
              phone: eObj.phone,
              profilePicture: eObj.profilePicture,
              customId: eObj.customId,
              nickname: 'Linked Senior',
              isSavedContact: false,
              isLinkedDependent: true,
            });
          }
        }
      }
    }

    // 3. Add linked caregiver (for elderly)
    if (user.linkedCaregiverId && user.linkedCaregiverId._id) {
      const cObj = user.linkedCaregiverId.toObject
        ? user.linkedCaregiverId.toObject()
        : user.linkedCaregiverId;
      const key = cObj._id.toString();
      if (!contactMap.has(key)) {
        contactMap.set(key, {
          _id: cObj._id,
          firstName: cObj.firstName,
          lastName: cObj.lastName,
          role: 'caregiver',
          phone: cObj.phone,
          profilePicture: cObj.profilePicture,
          customId: cObj.customId,
          nickname: 'Linked Caregiver',
          isSavedContact: false,
          isLinkedCaregiver: true,
        });
      }
    }

    const contactsList = Array.from(contactMap.values());

    res.status(200).json({
      success: true,
      count: contactsList.length,
      data: contactsList,
    });
  } catch (error) {
    console.error('Get Contacts Error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while fetching contacts',
      error: error.message,
    });
  }
};

// @desc    Remove a contact from contacts list
// @route   DELETE /api/messages/contacts/:contactUserId
// @access  Private
const removeContact = async (req, res) => {
  try {
    const { contactUserId } = req.params;
    const currentUser = await User.findById(req.user._id);

    if (!currentUser.contacts) {
      currentUser.contacts = [];
    }

    const initialCount = currentUser.contacts.length;
    currentUser.contacts = currentUser.contacts.filter(
      (c) => c.user && c.user.toString() !== contactUserId.toString()
    );

    if (currentUser.contacts.length === initialCount) {
      return res.status(404).json({
        success: false,
        message: 'Contact not found in your contacts list',
      });
    }

    await currentUser.save();

    res.status(200).json({
      success: true,
      message: 'Contact removed successfully',
    });
  } catch (error) {
    console.error('Remove Contact Error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while removing contact',
      error: error.message,
    });
  }
};

module.exports = {
  getConversations,
  getMessages,
  sendMessage,
  markThreadRead,
  searchContactByPhone,
  addContact,
  getContacts,
  removeContact,
};
