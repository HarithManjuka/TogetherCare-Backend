// socket.js
const { Server } = require('socket.io');
const Message = require('./models/Message');
const User = require('./models/User');
const { createNotification } = require('./controllers/notificationController');

let io = null;
const onlineUsers = new Map(); // userId -> Set of socketIds

/**
 * Initialize Socket.io on the HTTP server
 */
const initSocket = (server) => {
  io = new Server(server, {
    cors: {
      origin: '*',
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    },
    pingTimeout: 60000,
    pingInterval: 25000,
  });

  io.on('connection', (socket) => {
    let currentUserId = null;

    // Handle user registration with socket
    socket.on('join', (userId) => {
      if (!userId) return;
      currentUserId = userId.toString();
      socket.join(`user_${currentUserId}`);

      if (!onlineUsers.has(currentUserId)) {
        onlineUsers.set(currentUserId, new Set());
      }
      onlineUsers.get(currentUserId).add(socket.id);

      // Broadcast user online status
      io.emit('user_status_changed', {
        userId: currentUserId,
        status: 'online',
      });
    });

    // Handle joining a specific thread room
    socket.on('join_thread', (threadId) => {
      if (threadId) {
        socket.join(`thread_${threadId}`);
      }
    });

    // Handle leaving a thread room
    socket.on('leave_thread', (threadId) => {
      if (threadId) {
        socket.leave(`thread_${threadId}`);
      }
    });

    // Real-time message sending
    socket.on('send_message', async (data, callback) => {
      try {
        const {
          senderId,
          recipientId,
          relatedSeniorId,
          messageType = 'text',
          text,
          content,
          audioUrl,
          audioDuration,
          durationSeconds,
        } = data;

        const messageText = (text || content || '').trim();
        const duration =
          audioDuration !== undefined
            ? audioDuration
            : durationSeconds !== undefined
            ? durationSeconds
            : 0;

        if (!recipientId || !senderId) {
          if (callback) callback({ success: false, message: 'Sender and recipient are required' });
          return;
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

        const responseData = populatedMessage.toObject
          ? populatedMessage.toObject()
          : { ...populatedMessage };
        responseData.content = responseData.text;
        responseData.durationSeconds = responseData.audioDuration;

        // Emit to recipient's personal room & sender's personal room
        io.to(`user_${recipientId}`).emit('receive_message', responseData);
        io.to(`user_${senderId}`).emit('receive_message', responseData);

        // Also emit to thread room if both are in it
        const threadRoom = [senderId, recipientId].sort().join('_');
        io.to(`thread_${threadRoom}`).emit('receive_message', responseData);

        // Send push/in-app notification
        const sender = await User.findById(senderId);
        const senderName = sender ? `${sender.firstName} ${sender.lastName || ''}`.trim() : 'User';
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

        if (callback) callback({ success: true, data: responseData });
      } catch (err) {
        console.error('Socket send_message error:', err);
        if (callback) callback({ success: false, message: err.message });
      }
    });

    // Real-time typing indicators
    socket.on('typing', ({ senderId, recipientId, isTyping }) => {
      if (recipientId) {
        io.to(`user_${recipientId}`).emit('user_typing', {
          senderId,
          isTyping,
        });
      }
    });

    // Real-time read status
    socket.on('read_thread', async ({ senderId, otherUserId }) => {
      try {
        if (!senderId || !otherUserId) return;
        await Message.updateMany(
          { sender: otherUserId, recipient: senderId, isRead: false },
          { isRead: true }
        );

        // Notify other user that their messages were read
        io.to(`user_${otherUserId}`).emit('messages_read', {
          readBy: senderId,
        });

        // Also notify reader so client-side unread badges update immediately
        io.to(`user_${senderId}`).emit('messages_read', {
          readBy: senderId,
          threadWith: otherUserId,
        });
      } catch (err) {
        console.error('Socket read_thread error:', err);
      }
    });

    // Handle check online status
    socket.on('check_online', (userId, callback) => {
      const isOnline = onlineUsers.has(userId.toString()) && onlineUsers.get(userId.toString()).size > 0;
      if (callback) callback({ userId, isOnline });
    });

    // Disconnect cleanup
    socket.on('disconnect', () => {
      if (currentUserId && onlineUsers.has(currentUserId)) {
        const userSockets = onlineUsers.get(currentUserId);
        userSockets.delete(socket.id);
        if (userSockets.size === 0) {
          onlineUsers.delete(currentUserId);
          io.emit('user_status_changed', {
            userId: currentUserId,
            status: 'offline',
          });
        }
      }
    });
  });

  return io;
};

/**
 * Get active Socket.io instance
 */
const getIO = () => {
  return io;
};

module.exports = {
  initSocket,
  getIO,
  onlineUsers,
};
