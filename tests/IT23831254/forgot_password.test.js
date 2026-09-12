// tests/IT23831254/forgot_password.test.js
const request = require('supertest');
const crypto = require('crypto');
const app = require('../../server');
const User = require('../../models/User');
require('../setup');

describe('IT23831254: Forgot Password & Password Reset Integration Tests', () => {
  const userPayload = {
    firstName: 'Saman',
    lastName: 'Kumara',
    email: 'saman.kumara@example.com',
    password: 'OriginalPassword123!',
    phone: '0773334455',
    role: 'elderly',
    dateOfBirth: '1965-08-12',
    gender: 'male',
    address: { streetAddress: '78 High St', city: 'Matara', postalCode: '81000', district: 'Matara', province: 'Southern' },
  };

  let userId;

  beforeEach(async () => {
    const res = await request(app).post('/api/auth/register').send(userPayload);
    userId = res.body.user._id;
  });

  it('should generate password reset OTP on request', async () => {
    const res = await request(app)
      .post('/api/auth/forgot-password')
      .send({ email: userPayload.email });

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);

    const dbUser = await User.findById(userId).select('+resetPasswordOtpHash +resetPasswordOtpExpires');
    expect(dbUser.resetPasswordOtpHash).toBeDefined();
    expect(dbUser.resetPasswordOtpExpires).toBeDefined();
  });

  it('should validate reset OTP and reset user password successfully', async () => {
    // 1. Inject deterministic reset OTP '5678'
    const resetOtp = '5678';
    const hashedOtp = crypto.createHash('sha256').update(resetOtp).digest('hex');

    await User.findByIdAndUpdate(userId, {
      resetPasswordOtpHash: hashedOtp,
      resetPasswordOtpExpires: Date.now() + 10 * 60 * 1000,
    });

    // 2. Validate OTP endpoint
    const validateRes = await request(app)
      .post('/api/auth/verify-reset-otp')
      .send({ email: userPayload.email, otp: resetOtp });

    expect(validateRes.statusCode).toBe(200);
    expect(validateRes.body.success).toBe(true);
    expect(validateRes.body).toHaveProperty('sessionToken');

    const sessionToken = validateRes.body.sessionToken;

    // 3. Reset password with sessionToken
    const newPassword = 'NewSecurePassword999!';
    const resetRes = await request(app)
      .post('/api/auth/reset-password')
      .send({
        email: userPayload.email,
        sessionToken,
        newPassword,
      });

    expect(resetRes.statusCode).toBe(200);
    expect(resetRes.body.success).toBe(true);

    // 4. Authenticate with new password
    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({
        email: userPayload.email,
        password: newPassword,
      });

    expect(loginRes.statusCode).toBe(200);
    expect(loginRes.body).toHaveProperty('token');
  });
});
