// tests/IT23831254/admin_management.test.js
const request = require('supertest');
const app = require('../../server');
require('../setup');

describe('IT23831254: Admin Management & Verification Integration Tests', () => {
  const adminPayload = {
    firstName: 'Super',
    lastName: 'Admin',
    email: 'admin.manage@togethercare.com',
    password: 'AdminPassword123!',
    phone: '0770001111',
    role: 'admin',
    dateOfBirth: '1980-01-01',
    gender: 'male',
    address: { streetAddress: '1 Admin Way', city: 'Colombo', postalCode: '00100', district: 'Colombo', province: 'Western' },
  };

  const volunteerPayload = {
    firstName: 'Kasun',
    lastName: 'Fernando',
    email: 'kasun.vol@example.com',
    password: 'VolPassword123!',
    phone: '0778889999',
    role: 'volunteer',
    volunteerIdType: 'NIC',
    volunteerIdNumber: '961234567V',
    dateOfBirth: '1996-04-12',
    gender: 'male',
    address: { streetAddress: '15 Station Rd', city: 'Negombo', postalCode: '11500', district: 'Gampaha', province: 'Western' },
  };

  let adminToken;
  let volunteerId;

  beforeEach(async () => {
    const adminRes = await request(app).post('/api/auth/register').send(adminPayload);
    adminToken = adminRes.body.token;

    const volRes = await request(app).post('/api/auth/register').send(volunteerPayload);
    volunteerId = volRes.body.user._id;
  });

  it('should allow Admin to fetch paginated user directory', async () => {
    const res = await request(app)
      .get('/api/auth/users')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.users)).toBe(true);
    expect(res.body.users.length).toBeGreaterThanOrEqual(2);
  });

  it('should allow Admin to update volunteer verification badge status', async () => {
    const res = await request(app)
      .patch(`/api/auth/users/${volunteerId}/verification`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'verified', note: 'NIC and background check approved' });

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.user.verificationBadgeStatus).toBe('verified');
  });

  it('should allow Admin to delete a user account', async () => {
    const deleteRes = await request(app)
      .delete(`/api/auth/users/${volunteerId}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(deleteRes.statusCode).toBe(200);
    expect(deleteRes.body.success).toBe(true);
  });
});
