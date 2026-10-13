// config/db.js
const mongoose = require('mongoose');

// Global cache for serverless environments (preserves connection across warm Lambdas)
let cached = global.mongoose;

if (!cached) {
  cached = global.mongoose = { conn: null, promise: null };
}

const connectDB = async () => {
  // If already connected, reuse existing connection
  if (cached.conn && mongoose.connection.readyState === 1) {
    return cached.conn;
  }

  if (!cached.promise) {
    const mongoUri = process.env.MONGO_URI;

    if (!mongoUri) {
      const err = new Error('MONGO_URI environment variable is not defined.');
      console.error(`❌ ${err.message}`);
      if (!process.env.VERCEL && process.env.NODE_ENV !== 'test') {
        process.exit(1);
      }
      throw err;
    }

    const opts = {
      serverSelectionTimeoutMS: 10000,
    };

    cached.promise = mongoose.connect(mongoUri, opts).then((mongooseInstance) => {
      console.log(`🍃 MongoDB Connected: ${mongooseInstance.connection.host}`);
      return mongooseInstance;
    }).catch((error) => {
      cached.promise = null; // Reset promise so subsequent requests can retry
      console.error(`❌ Database connection error: ${error.message}`);
      if (!process.env.VERCEL && process.env.NODE_ENV !== 'test') {
        process.exit(1);
      }
      throw error;
    });
  }

  try {
    cached.conn = await cached.promise;
    return cached.conn;
  } catch (e) {
    cached.promise = null;
    throw e;
  }
};

const disconnectDB = async () => {
  try {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.connection.close();
      cached.conn = null;
      cached.promise = null;
      console.log('🍃 MongoDB connection closed gracefully.');
    }
  } catch (error) {
    console.error(`❌ Error disconnecting MongoDB: ${error.message}`);
  }
};

module.exports = connectDB;
module.exports.connectDB = connectDB;
module.exports.disconnectDB = disconnectDB;