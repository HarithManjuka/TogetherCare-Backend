// tests/IT23831254/volunteer_verification.test.js
const request = require('supertest');
const app = require('../../server');
const User = require('../../models/User');
require('../setup');

describe('Volunteer ID Verification & Evidence Review Integration Tests', () => {
  const adminPayload = {
    firstName: 'Admin',
    lastName: 'Verifier',
    email: 'admin.verify@togethercare.com',
    password: 'AdminPassword123!',
    phone: '0770002222',
    role: 'admin',
    dateOfBirth: '1985-02-02',
    gender: 'female',
    address: { streetAddress: '2 Admin Blvd', city: 'Colombo', postalCode: '00100', district: 'Colombo', province: 'Western' },
  };

  const volunteerPayload = {
    firstName: 'Chamara',
    lastName: 'Silva',
    email: 'chamara.vol@example.com',
    password: 'VolPassword123!',
    phone: '0779998888',
    role: 'volunteer',
    volunteerIdType: 'NIC',
    volunteerIdNumber: '951234567V',
    dateOfBirth: '1995-05-15',
    gender: 'male',
    address: { streetAddress: '10 Main Rd', city: 'Kandy', postalCode: '20000', district: 'Kandy', province: 'Central' },
  };

  let adminToken;
  let volunteerToken;
  let volunteerId;

  beforeEach(async () => {
    const adminRes = await request(app).post('/api/auth/register').send(adminPayload);
    adminToken = adminRes.body.token;

    const volRes = await request(app).post('/api/auth/register').send(volunteerPayload);
    volunteerToken = volRes.body.token;
    volunteerId = volRes.body.user._id;
  });

  it('should reject verification submission if no evidence files attached', async () => {
    const res = await request(app)
      .post('/api/auth/volunteer-verification')
      .set('Authorization', `Bearer ${volunteerToken}`)
      .send({ credentialType: 'NIC', credentialNumber: '951234567V' });

    expect(res.statusCode).toBe(400);
    expect(res.body.status).toBe('fail');
    expect(res.body.message).toContain('Please attach at least one piece of evidence');
  });

  it('should reject review attempts by non-admin users', async () => {
    const res = await request(app)
      .put(`/api/admin/users/${volunteerId}/verify-volunteer`)
      .set('Authorization', `Bearer ${volunteerToken}`)
      .send({ action: 'approve' });

    expect(res.statusCode).toBe(403);
  });

  it('should reject admin review when rejection reason is missing', async () => {
    const res = await request(app)
      .put(`/api/admin/users/${volunteerId}/verify-volunteer`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ action: 'reject', rejectionReason: '   ' });

    expect(res.statusCode).toBe(400);
    expect(res.body.status).toBe('fail');
    expect(res.body.message).toContain('Rejection reason is required');
  });

  it('should allow admin to approve volunteer verification', async () => {
    // Manually simulate evidence in pending state
    await User.findByIdAndUpdate(volunteerId, {
      'volunteerVerification.status': 'PENDING',
      'volunteerVerification.credentialType': 'NIC',
      'volunteerVerification.credentialNumber': '951234567V',
      'volunteerVerification.evidenceFiles': [
        {
          url: 'https://res.cloudinary.com/demo/image/upload/sample.jpg',
          publicId: 'evidence_sample_1',
          fileType: 'image',
          documentCategory: 'nic_front',
          fileSize: 102400,
        },
      ],
      verificationBadgeStatus: 'pending',
    });

    const res = await request(app)
      .put(`/api/admin/users/${volunteerId}/verify-volunteer`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ action: 'approve' });

    expect(res.statusCode).toBe(200);
    expect(res.body.status).toBe('success');
    expect(res.body.data.user.volunteerVerification.status).toBe('APPROVED');
    expect(res.body.data.user.isVolunteerVerified).toBe(true);
    expect(res.body.data.user.verificationBadgeStatus).toBe('verified');
  });

  it('should allow admin to reject volunteer verification with reason', async () => {
    const res = await request(app)
      .put(`/api/admin/users/${volunteerId}/verify-volunteer`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ action: 'reject', rejectionReason: 'NIC photo is too blurry to read number.' });

    expect(res.statusCode).toBe(200);
    expect(res.body.status).toBe('success');
    expect(res.body.data.user.volunteerVerification.status).toBe('REJECTED');
    expect(res.body.data.user.volunteerVerification.rejectionReason).toBe('NIC photo is too blurry to read number.');
    expect(res.body.data.user.isVolunteerVerified).toBe(false);
    expect(res.body.data.user.verificationBadgeStatus).toBe('rejected');
  });
});
