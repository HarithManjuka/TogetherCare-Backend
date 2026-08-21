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
app.use(express.json());

// Mount API Routers
app.use('/api/auth', require('./routes/authRoutes'));

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