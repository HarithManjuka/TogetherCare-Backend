// controllers/messageController.js
const Message = require('../models/Message');
const User = require('../models/User');
const { createNotification } = require('./notificationController');

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
      .populate('sender', 'firstName lastName role profilePicture customId')
      .populate('recipient', 'firstName lastName role profilePicture customId')
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
      .populate('sender', 'firstName lastName role profilePicture customId')
      .populate('recipient', 'firstName lastName role profilePicture customId')
      .populate('relatedSenior', 'firstName lastName customId')
      .sort({ createdAt: 1 });

    // Mark unread messages sent to me as read
    await Message.updateMany(
      { sender: otherUserId, recipient: userId, isRead: false },
      { isRead: true }
    );

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
    const { recipientId, relatedSeniorId, messageType, text, content, audioUrl, audioDuration, durationSeconds } = req.body;

    const messageText = (text || content || '').trim();
    const duration = audioDuration !== undefined ? audioDuration : (durationSeconds !== undefined ? durationSeconds : 0);

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
      .populate('sender', 'firstName lastName role profilePicture customId')
      .populate('recipient', 'firstName lastName role profilePicture customId')
      .populate('relatedSenior', 'firstName lastName customId');

    // Notify recipient
    const senderName = `${req.user.firstName} ${req.user.lastName || ''}`.trim();
    const notifSnippet = messageType === 'voice' ? '🎤 Sent you a voice message' : messageText.slice(0, 60);

    await createNotification({
      recipient: recipientId,
      sender: senderId,
      senior: relatedSeniorId || null,
      type: 'message',
      title: `Message from ${senderName}`,
      message: notifSnippet,
      data: { messageId: message._id, senderId },
    });

    const responseData = populatedMessage.toObject ? populatedMessage.toObject() : { ...populatedMessage };
    responseData.content = responseData.text;
    responseData.durationSeconds = responseData.audioDuration;

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

module.exports = {
  getConversations,
  getMessages,
  sendMessage,
  markThreadRead,
};
