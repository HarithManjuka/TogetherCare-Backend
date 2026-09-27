const request = require('supertest');
const app = require('../../server');
const CompanionshipRequest = require('../../models/CompanionshipRequest');
require('../setup');

describe('IT23819092: Volunteer Task & Bidding Integration Tests', () => {
  it('should include legacy open companionship requests in open-request browsing', async () => {
    const volunteerRegisterRes = await request(app)
      .post('/api/auth/register')
      .send({
        firstName: 'Kamal',
        lastName: 'Fernando',
        email: 'kamal.openrequests@example.com',
        password: 'SecurePassword123!',
        phone: '0771234888',
        role: 'volunteer',
        dateOfBirth: '1998-06-20',
        gender: 'male',
        address: {
          streetAddress: '45 Galle Road',
          city: 'Colombo 03',
          postalCode: '00300',
          district: 'Colombo',
          province: 'Western',
        },
        volunteerIdType: 'NIC',
        volunteerIdNumber: '199812345678',
      });

    const elderlyRegisterRes = await request(app)
      .post('/api/auth/register')
      .send({
        firstName: 'Nimal',
        lastName: 'Perera',
        email: 'nimal.openrequests@example.com',
        password: 'SecurePassword123!',
        phone: '0771234567',
        role: 'elderly',
        dateOfBirth: '1960-05-15',
        gender: 'male',
        address: {
          streetAddress: '12 Temple Road',
          city: 'Kandy',
          postalCode: '20000',
          district: 'Kandy',
          province: 'Central',
        },
      });

    const elderlyUserId = elderlyRegisterRes.body.user._id || elderlyRegisterRes.body.user.id;

    await CompanionshipRequest.collection.insertOne({
      elderly: elderlyUserId,
      activityType: 'Companionship',
      scheduledDate: new Date(Date.now() + 24 * 60 * 60 * 1000),
      timeSlot: '10:00 AM - 11:00 AM',
      startTime: '10:00 AM',
      endTime: '11:00 AM',
      communicationMethod: 'chat',
      location: 'Kandy',
      notes: 'Legacy seeded request',
      status: 'open',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const res = await request(app)
      .get('/api/companionship/open-requests')
      .set('Authorization', 'Bearer ' + volunteerRegisterRes.body.token);

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBe(1);
    expect(res.body.data[0].status).toBe('open');
  });
});
