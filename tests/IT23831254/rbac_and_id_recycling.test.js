// tests/IT23831254/rbac_and_id_recycling.test.js
const request = require('supertest');
const app = require('../../server');
const User = require('../../models/User');
require('../setup');

describe('IT23831254: RBAC & Custom ID Gap Recycling Integration Tests', () => {
  const volunteerPayload1 = {
    firstName: 'Gamini',
    lastName: 'Silva',
    email: 'gamini.vol@example.com',
    password: 'SecureVolPassword123!',
    phone: '0771112233',
    role: 'volunteer',
    volunteerIdType: 'NIC',
    volunteerIdNumber: '951234567V',
    dateOfBirth: '1995-03-20',
    gender: 'male',
    address: { streetAddress: '45 Lake Road', city: 'Colombo', postalCode: '00100', district: 'Colombo', province: 'Western' },
  };

  const volunteerPayload2 = {
    firstName: 'Harith',
    lastName: 'Abeykoon',
    email: 'harith.vol@example.com',
    password: 'SecureVolPassword123!',
    phone: '0774445566',
    role: 'volunteer',
    volunteerIdType: 'NIC',
    volunteerIdNumber: '981234567V',
    dateOfBirth: '1998-07-10',
    gender: 'male',
    address: { streetAddress: '10 Kandy Road', city: 'Kandy', postalCode: '20000', district: 'Kandy', province: 'Central' },
  };

  const adminPayload = {
    firstName: 'Admin',
    lastName: 'User',
    email: 'admin.system@togethercare.com',
    password: 'AdminPassword123!',
    phone: '0770000000',
    role: 'admin',
    dateOfBirth: '1985-01-01',
    gender: 'male',
    address: { streetAddress: '1 Main St', city: 'Colombo', postalCode: '00100', district: 'Colombo', province: 'Western' },
  };

  it('should assign sequential custom IDs across roles (VOL-0001, VOL-0002, ADM-0001)', async () => {
    const vol1Res = await request(app).post('/api/auth/register').send(volunteerPayload1);
    expect(vol1Res.statusCode).toBe(201);
    expect(vol1Res.body.user.customId).toBe('VOL-0001');

    const vol2Res = await request(app).post('/api/auth/register').send(volunteerPayload2);
    expect(vol2Res.statusCode).toBe(201);
    expect(vol2Res.body.user.customId).toBe('VOL-0002');

    const admRes = await request(app).post('/api/auth/register').send(adminPayload);
    expect(admRes.statusCode).toBe(201);
    expect(admRes.body.user.customId).toBe('ADM-0001');
  });

  it('should enforce RBAC by blocking non-admin users from admin endpoints', async () => {
    const volRes = await request(app).post('/api/auth/register').send(volunteerPayload1);
    const volToken = volRes.body.token;

    const listRes = await request(app)
      .get('/api/auth/users')
      .set('Authorization', `Bearer ${volToken}`);

    expect(listRes.statusCode).toBe(403);
    expect(listRes.body.message).toMatch(/not authorized/i);
  });

  it('should recycle minimal deleted custom ID gaps upon new user registration', async () => {
    // 1. Create VOL-0001 and VOL-0002
    const v1 = await request(app).post('/api/auth/register').send(volunteerPayload1);
    const v2 = await request(app).post('/api/auth/register').send(volunteerPayload2);
    expect(v1.body.user.customId).toBe('VOL-0001');
    expect(v2.body.user.customId).toBe('VOL-0002');

    // 2. Delete VOL-0001
    await User.findByIdAndDelete(v1.body.user._id);

    // 3. Create a new volunteer -> should recycle VOL-0001 instead of generating VOL-0003
    const newVolPayload = {
      ...volunteerPayload1,
      email: 'recycled.vol@example.com',
    };
    const recycledRes = await request(app).post('/api/auth/register').send(newVolPayload);
    expect(recycledRes.statusCode).toBe(201);
    expect(recycledRes.body.user.customId).toBe('VOL-0001');
  });
});
