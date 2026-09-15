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

  it('should reject ban attempts when reason is missing', async () => {
    const res = await request(app)
      .post(`/api/admin/users/${volunteerId}/ban`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ banType: 'permanent' });

    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toContain('Reason for ban is required');
  });

  it('should prevent an admin from banning another admin account', async () => {
    // Create second admin
    const secondAdminRes = await request(app).post('/api/auth/register').send({
      firstName: 'Admin',
      lastName: 'Two',
      email: 'admin.two@togethercare.com',
      password: 'AdminPassword123!',
      phone: '0770002222',
      role: 'admin',
      dateOfBirth: '1985-05-05',
      gender: 'male',
      address: { streetAddress: '2 Admin Way', city: 'Colombo', postalCode: '00100', district: 'Colombo', province: 'Western' },
    });

    const secondAdminId = secondAdminRes.body.user._id;

    const banRes = await request(app)
      .post(`/api/admin/users/${secondAdminId}/ban`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ banType: 'permanent', reason: 'Attempt to ban admin' });

    expect(banRes.statusCode).toBe(403);
    expect(banRes.body.success).toBe(false);
    expect(banRes.body.message).toContain('Admin accounts cannot be banned');
  });

  it('should prevent an admin from editing another admin account details', async () => {
    // Create second admin
    const secondAdminRes = await request(app).post('/api/auth/register').send({
      firstName: 'Admin',
      lastName: 'Three',
      email: 'admin.three@togethercare.com',
      password: 'AdminPassword123!',
      phone: '0770003333',
      role: 'admin',
      dateOfBirth: '1988-08-08',
      gender: 'female',
      address: { streetAddress: '3 Admin Way', city: 'Colombo', postalCode: '00100', district: 'Colombo', province: 'Western' },
    });

    const secondAdminId = secondAdminRes.body.user._id;

    const editRes = await request(app)
      .put(`/api/admin/users/${secondAdminId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ firstName: 'HackedAdmin' });

    expect(editRes.statusCode).toBe(403);
    expect(editRes.body.success).toBe(false);
    expect(editRes.body.message).toContain('Admin accounts cannot be edited by another admin');
  });

  it('should allow Admin to create a new user with full role-based attributes and validations', async () => {
    const createRes = await request(app)
      .post('/api/admin/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        role: 'volunteer',
        firstName: 'Nimal',
        lastName: 'Perera',
        email: 'nimal.vol@togethercare.com',
        password: 'VolPassword123!',
        phone: '0771234567',
        dateOfBirth: '1998-05-15',
        gender: 'male',
        address: {
          streetAddress: '45 Galle Rd',
          city: 'Colombo',
          postalCode: '00300',
          district: 'Colombo',
          province: 'Western',
        },
        volunteerIdType: 'Student ID',
        volunteerIdNumber: 'STU-998877',
        educationalInstitution: 'University of Colombo',
      });

    expect(createRes.statusCode).toBe(201);
    expect(createRes.body.success).toBe(true);
    expect(createRes.body.user.customId).toBeDefined();
    expect(createRes.body.user.educationalInstitution).toBe('University of Colombo');
    expect(createRes.body.user.isEmailVerified).toBe(false);
    expect(createRes.body.user.accountStatus).toBe('pending_verification');
  });

  it('should return warning message when banned user attempts to log in', async () => {
    // Ban volunteer permanently
    await request(app)
      .post(`/api/admin/users/${volunteerId}/ban`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ banType: 'permanent', reason: 'Violation of community guidelines' });

    // Attempt login as banned volunteer
    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ email: volunteerPayload.email, password: volunteerPayload.password });

    expect(loginRes.statusCode).toBe(403);
    expect(loginRes.body.success).toBe(false);
    expect(loginRes.body.isBanned).toBe(true);
    expect(loginRes.body.message).toContain('You are banned from TogetherCare Community permanently');
  });
});
