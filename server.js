// server.js
const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const connectDB = require('./config/db');

dotenv.config();
connectDB();

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
app.listen(PORT, () => {
  console.log(`🚀 TogetherCare Server running on port ${PORT}`);
});