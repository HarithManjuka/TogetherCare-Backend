// tests/IT23831254/email_verification.test.js
const request = require('supertest');
const crypto = require('crypto');
const app = require('../../server');
const User = require('../../models/User');
require('../setup');

describe('IT23831254: Email Verification Process Integration Tests', () => {
  const testUserPayload = {
    firstName: 'Amanda',
    lastName: 'Pathirana',
    email: 'amanda.pathirana@example.com',
    password: 'SecurePassword123!',
    phone: '0788562080',
    role: 'volunteer',
    volunteerIdType: 'NIC',
    volunteerIdNumber: '200212345678',
    dateOfBirth: '2002-03-19',
    gender: 'female',
    address: { streetAddress: '12 Beach Road', city: 'Galle', postalCode: '80000', district: 'Galle', province: 'Southern' },
  };

  let token;
  let userId;

  beforeEach(async () => {
    const res = await request(app).post('/api/auth/register').send(testUserPayload);
    token = res.body.token;
    userId = res.body.user._id;
  });

  it('should request an in-profile email verification OTP code', async () => {
    const res = await request(app)
      .post('/api/auth/send-email-verification-otp')
      .set('Authorization', `Bearer ${token}`);

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.message).toMatch(/verification code sent/i);

    const dbUser = await User.findById(userId).select('+emailVerificationOtpHash +emailVerificationOtpExpires');
    expect(dbUser.emailVerificationOtpHash).toBeDefined();
    expect(dbUser.emailVerificationOtpExpires).toBeDefined();
  });

  it('should reject invalid or expired verification codes', async () => {
    await request(app)
      .post('/api/auth/send-email-verification-otp')
      .set('Authorization', `Bearer ${token}`);

    const res = await request(app)
      .post('/api/auth/verify-profile-email')
      .set('Authorization', `Bearer ${token}`)
      .send({ otp: '0000' });

    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toMatch(/invalid or expired/i);
  });

  it('should verify profile email successfully with valid OTP code', async () => {
    // 1. Manually set known OTP '1234' on DB user for deterministic test
    const rawOtp = '1234';
    const hashedOtp = crypto.createHash('sha256').update(rawOtp).digest('hex');

    await User.findByIdAndUpdate(userId, {
      emailVerificationOtpHash: hashedOtp,
      emailVerificationOtpExpires: Date.now() + 10 * 60 * 1000,
      isEmailVerified: false,
    });

    // 2. Submit valid OTP
    const verifyRes = await request(app)
      .post('/api/auth/verify-profile-email')
      .set('Authorization', `Bearer ${token}`)
      .send({ otp: rawOtp });

    expect(verifyRes.statusCode).toBe(200);
    expect(verifyRes.body.success).toBe(true);

    // 3. Confirm user is verified in database
    const dbUser = await User.findById(userId);
    expect(dbUser.isEmailVerified).toBe(true);
    expect(dbUser.accountStatus).toBe('active');
  });
});
