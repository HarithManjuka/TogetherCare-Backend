// tests/setup.js
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
require('dotenv').config();

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_jwt_secret_key_1234567890';
process.env.NODE_ENV = 'test';

let mongoServer;

beforeAll(async () => {
  // Use isolated test database on Atlas if available to avoid 780MB binary download in Windows
  const testUri = process.env.TEST_MONGO_URI || (process.env.MONGO_URI ? process.env.MONGO_URI.replace(/\/\?/, '/togethercare_test_it23818620?') : null);
  if (testUri) {
    await mongoose.connect(testUri);
  } else {
    mongoServer = await MongoMemoryServer.create();
    const uri = mongoServer.getUri();
    await mongoose.connect(uri);
  }

  // Ensure completely clean database before any tests run
  if (mongoose.connection.readyState === 1) {
    const collections = mongoose.connection.collections;
    for (const key in collections) {
      await collections[key].deleteMany();
    }
  }
}, 300000);

afterEach(async () => {
  if (mongoose.connection.readyState === 1) {
    const collections = mongoose.connection.collections;
    for (const key in collections) {
      await collections[key].deleteMany();
    }
  }
});

afterAll(async () => {
  if (mongoose.connection.readyState === 1) {
    const collections = mongoose.connection.collections;
    for (const key in collections) {
      await collections[key].deleteMany();
    }
  }
  await mongoose.disconnect();
  if (mongoServer) {
    await mongoServer.stop();
  }
});

