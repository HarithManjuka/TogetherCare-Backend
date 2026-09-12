// server.js
const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const { connectDB, disconnectDB } = require('./config/db');

dotenv.config();

if (process.env.NODE_ENV !== 'test') {
  connectDB();
}

const app = express();

// Global Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

// Mount API Routers
app.use('/api/auth', require('./routes/authRoutes'));
app.use('/api/companionship', require('./routes/companionshipRoutes'));
app.use('/api/reviews', require('./routes/reviewRoutes'));
app.use('/api/interests', require('./routes/interestRoutes'));
app.use('/api/activities', require('./routes/activityRoutes'));
app.use('/api/volunteer-offers', require('./routes/volunteerOfferRoutes'));
app.use('/api/caregiver/dependents', require('./routes/dependentsRoutes'));
app.use('/api/help-requests', require('./routes/helpRequestRoutes'));

// Health Check Route
app.get('/api/health', (req, res) => {
  res.status(200).json({ status: 'success', message: 'TogetherCare API is live' });
});

// Centralized 404 Handler
app.use((req, res) => {
  res.status(404).json({ success: false, message: `Route ${req.originalUrl} not found` });
});

const PORT = process.env.PORT || 5001;

if (process.env.NODE_ENV !== 'test') {
  const server = app.listen(PORT, () => {
    console.log(`🚀 TogetherCare Server running in ${process.env.NODE_ENV || 'development'} mode on port ${PORT}`);
  });

  let isShuttingDown = false;

  const handleGracefulShutdown = async (signal, exitCode = 0) => {
    if (isShuttingDown) return;
    isShuttingDown = true;

    console.log(`\n🛑 Received ${signal}. Initiating graceful shutdown...`);

    // Safety timeout: force exit after 10 seconds if connections hang
    const forceExitTimeout = setTimeout(() => {
      console.error('⚠️ Shutdown timed out after 10s, forcing exit.');
      process.exit(1);
    }, 10000);
    forceExitTimeout.unref();

    // 1. Stop receiving new HTTP requests
    server.close(async (err) => {
      if (err) {
        console.error('❌ Error closing Express HTTP server:', err);
      } else {
        console.log('🔒 Express HTTP server closed to new connections.');
      }

      // 2. Disconnect MongoDB connection pool
      await disconnectDB();

      console.log('👋 TogetherCare Server shutdown complete. Goodbye!');

      // If nodemon sent SIGUSR2, kill current PID with SIGUSR2 to let nodemon restart
      if (signal === 'SIGUSR2') {
        process.kill(process.pid, 'SIGUSR2');
      } else {
        process.exit(exitCode);
      }
    });
  };

  // Signal Listeners
  process.on('SIGINT', () => handleGracefulShutdown('SIGINT', 0));
  process.on('SIGTERM', () => handleGracefulShutdown('SIGTERM', 0));

  // Nodemon restart listener
  process.once('SIGUSR2', () => handleGracefulShutdown('SIGUSR2', 0));

  // Global uncaught errors / unhandled rejections
  process.on('uncaughtException', (err) => {
    console.error('💥 UNCAUGHT EXCEPTION! Shutting down...', err);
    handleGracefulShutdown('uncaughtException', 1);
  });

  process.on('unhandledRejection', (reason) => {
    console.error('💥 UNHANDLED REJECTION! Shutting down...', reason);
    handleGracefulShutdown('unhandledRejection', 1);
  });
}

module.exports = app;