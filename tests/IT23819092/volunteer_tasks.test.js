// tests/IT23819092/volunteer_tasks.test.js
const request = require('supertest');
const app = require('../../server');
const HelpRequest = require('../../models/HelpRequest');
const User = require('../../models/User');
require('../setup');

describe('IT23819092: Volunteer Task & Bidding Integration Tests', () => {
  let volunteerToken;
  let volunteerUser;

  const testVolunteerPayload = {
    firstName: 'Kamal',
    lastName: 'Fernando',
    email: 'kamal.volunteer@example.com',
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
  };

  beforeEach(async () => {
    // Register test volunteer
    const regRes = await request(app)
      .post('/api/auth/register')
      .send(testVolunteerPayload);

    volunteerToken = regRes.body.token;
    volunteerUser = regRes.body.user;
  });

  describe('Volunteer Offers CRUD Operations', () => {
    it('should create a new volunteer availability offer', async () => {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const dateStr = tomorrow.toISOString().split('T')[0];

      const res = await request(app)
        .post('/api/volunteer-offers')
        .set('Authorization', `Bearer ${volunteerToken}`)
        .send({
          services: ['Grocery Pickup', 'Pharmacy Run'],
          date: dateStr,
          startTime: '02:00 PM',
          endTime: '04:00 PM',
          serviceArea: 'Colombo 03',
          radius: 'Within 5 km',
          capacity: 3,
          specialSkills: 'Have vehicle and first aid knowledge',
        });

      expect(res.statusCode).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveProperty('_id');
      expect(res.body.data.slotsLeft).toBe(3);
      expect(res.body.data.volunteerName).toContain('Kamal');
    });

    it('should fetch offers created by the logged-in volunteer', async () => {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const dateStr = tomorrow.toISOString().split('T')[0];

      await request(app)
        .post('/api/volunteer-offers')
        .set('Authorization', `Bearer ${volunteerToken}`)
        .send({
          services: ['Companionship'],
          date: dateStr,
          startTime: '10:00 AM',
          endTime: '12:00 PM',
          serviceArea: 'Colombo 03',
          capacity: 2,
        });

      const res = await request(app)
        .get('/api/volunteer-offers/my-offers')
        .set('Authorization', `Bearer ${volunteerToken}`);

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.count).toBe(1);
    });

    it('should update an existing offer', async () => {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const dateStr = tomorrow.toISOString().split('T')[0];

      const createRes = await request(app)
        .post('/api/volunteer-offers')
        .set('Authorization', `Bearer ${volunteerToken}`)
        .send({
          services: ['Grocery Pickup'],
          date: dateStr,
          startTime: '01:00 PM',
          endTime: '03:00 PM',
          serviceArea: 'Colombo 03',
          capacity: 2,
        });

      const offerId = createRes.body.data._id;

      const updateRes = await request(app)
        .put(`/api/volunteer-offers/${offerId}`)
        .set('Authorization', `Bearer ${volunteerToken}`)
        .send({
          capacity: 4,
          radius: 'Within 10 km',
        });

      expect(updateRes.statusCode).toBe(200);
      expect(updateRes.body.success).toBe(true);
      expect(updateRes.body.data.capacity).toBe(4);
      expect(updateRes.body.data.radius).toBe('Within 10 km');
    });

    it('should delete / cancel an existing offer', async () => {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const dateStr = tomorrow.toISOString().split('T')[0];

      const createRes = await request(app)
        .post('/api/volunteer-offers')
        .set('Authorization', `Bearer ${volunteerToken}`)
        .send({
          services: ['Pharmacy Run'],
          date: dateStr,
          startTime: '09:00 AM',
          endTime: '11:00 AM',
          serviceArea: 'Colombo 03',
          capacity: 1,
        });

      const offerId = createRes.body.data._id;

      const delRes = await request(app)
        .delete(`/api/volunteer-offers/${offerId}`)
        .set('Authorization', `Bearer ${volunteerToken}`);

      expect(delRes.statusCode).toBe(200);
      expect(delRes.body.success).toBe(true);

      const getRes = await request(app)
        .get('/api/volunteer-offers/my-offers')
        .set('Authorization', `Bearer ${volunteerToken}`);

      expect(getRes.body.count).toBe(0);
    });
  });

  describe('Community Tasks, Scheduling & Completion Workflow', () => {
    let testSenior;
    let testCaregiver;
    let seededHelpReq;

    beforeEach(async () => {
      const ts = Date.now();
      const randPhone1 = `071${Math.floor(1000000 + Math.random() * 9000000)}`;
      const randPhone2 = `077${Math.floor(1000000 + Math.random() * 9000000)}`;

      const seniorRes = await request(app)
        .post('/api/auth/register')
        .send({
          firstName: 'Nimal',
          lastName: 'Perera',
          email: `nimal.senior.${ts}.${Math.random()}@example.com`,
          password: 'Password123!',
          phone: randPhone1,
          role: 'elderly',
          dateOfBirth: '1945-05-10',
          gender: 'male',
          address: {
            streetAddress: '12 Temple Road',
            city: 'Colombo 03',
            postalCode: '00300',
            district: 'Colombo',
            province: 'Western',
          },
        });
      testSenior = seniorRes.body.user;

      const caregiverRes = await request(app)
        .post('/api/auth/register')
        .send({
          firstName: 'Sunil',
          lastName: 'Perera',
          email: `sunil.caregiver.${ts}.${Math.random()}@example.com`,
          password: 'Password123!',
          phone: randPhone2,
          role: 'caregiver',
          caregiverType: 'family_member',
          dateOfBirth: '1975-05-10',
          gender: 'male',
          address: {
            streetAddress: '12 Temple Road',
            city: 'Colombo 03',
            postalCode: '00300',
            district: 'Colombo',
            province: 'Western',
          },
        });
      testCaregiver = caregiverRes.body.user;

      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 2);
      const dateStr = tomorrow.toISOString().split('T')[0];

      seededHelpReq = await HelpRequest.create({
        elderlyId: testSenior._id,
        caregiverId: testCaregiver._id,
        serviceType: 'Medicine',
        date: dateStr,
        time: '10:00 AM',
        location: '12 Temple Road, Colombo 03',
        status: 'searching',
      });
    });

    it('should browse available community requests', async () => {
      const res = await request(app)
        .get('/api/volunteer-offers/available-requests')
        .set('Authorization', `Bearer ${volunteerToken}`);

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBeGreaterThan(0);
    });

    it('should accept an open request and track it in schedule', async () => {
      // 1. Get available requests
      const availableRes = await request(app)
        .get('/api/volunteer-offers/available-requests')
        .set('Authorization', `Bearer ${volunteerToken}`);

      const firstReq = availableRes.body.data[0];
      const reqId = firstReq.id || firstReq._id;

      // 2. Accept request
      const acceptRes = await request(app)
        .post(`/api/volunteer-offers/requests/${reqId}/accept`)
        .set('Authorization', `Bearer ${volunteerToken}`);

      expect(acceptRes.statusCode).toBe(200);
      expect(acceptRes.body.success).toBe(true);

      // 3. Verify in schedule
      const schedRes = await request(app)
        .get('/api/volunteer-offers/my-schedule')
        .set('Authorization', `Bearer ${volunteerToken}`);

      expect(schedRes.statusCode).toBe(200);
      expect(schedRes.body.count).toBeGreaterThanOrEqual(1);
      const scheduledItem = schedRes.body.data.find(
        (item) => item.id === reqId || item._id === reqId
      );
      expect(scheduledItem).toBeDefined();
      expect(scheduledItem.status).toBe('confirmed');
    });

    it('should advance task status to arrived and completed, and update history/stats', async () => {
      // 1. Get available request & accept
      const availableRes = await request(app)
        .get('/api/volunteer-offers/available-requests')
        .set('Authorization', `Bearer ${volunteerToken}`);

      const reqId = availableRes.body.data[0].id || availableRes.body.data[0]._id;
      await request(app)
        .post(`/api/volunteer-offers/requests/${reqId}/accept`)
        .set('Authorization', `Bearer ${volunteerToken}`);

      // 2. Update status to arrived
      const arrivedRes = await request(app)
        .put(`/api/volunteer-offers/tasks/${reqId}/status`)
        .set('Authorization', `Bearer ${volunteerToken}`)
        .send({ status: 'arrived' });

      expect(arrivedRes.statusCode).toBe(200);
      expect(arrivedRes.body.data.status).toBe('arrived');

      // 3. Update status to completed
      const completeRes = await request(app)
        .put(`/api/volunteer-offers/tasks/${reqId}/status`)
        .set('Authorization', `Bearer ${volunteerToken}`)
        .send({ status: 'completed' });

      expect(completeRes.statusCode).toBe(200);
      expect(completeRes.body.data.status).toBe('completed');

      // 4. Verify in history
      const historyRes = await request(app)
        .get('/api/volunteer-offers/my-history')
        .set('Authorization', `Bearer ${volunteerToken}`);

      expect(historyRes.statusCode).toBe(200);
      expect(historyRes.body.count).toBeGreaterThanOrEqual(1);
      expect(historyRes.body.data[0]).toHaveProperty('rating');

      // 5. Verify metrics in stats
      const statsRes = await request(app)
        .get('/api/volunteer-offers/my-stats')
        .set('Authorization', `Bearer ${volunteerToken}`);

      expect(statsRes.statusCode).toBe(200);
      expect(statsRes.body.data.totalCompletedVisits).toBeGreaterThanOrEqual(1);
      expect(statsRes.body.data.hoursThisMonth).toBeGreaterThan(0);
    });

    it('should manually log past completed volunteer service via POST /api/volunteer-offers/my-history', async () => {
      const res = await request(app)
        .post('/api/volunteer-offers/my-history')
        .set('Authorization', `Bearer ${volunteerToken}`)
        .send({
          serviceType: 'Companionship',
          elderName: 'Nimal Perera',
          date: '2026-10-01',
          durationHours: '2.5',
          location: 'Colombo 03',
          notes: 'Helped with afternoon walk and smartphone setup',
          rating: 5,
          feedback: 'Wonderful conversation and company!',
        });

      expect(res.statusCode).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveProperty('id');
      expect(res.body.data.service).toBe('Companionship');
      expect(res.body.data.rating).toBe(5);

      const histRes = await request(app)
        .get('/api/volunteer-offers/my-history')
        .set('Authorization', `Bearer ${volunteerToken}`);

      expect(histRes.statusCode).toBe(200);
      const found = histRes.body.data.find(
        (h) => (h.id || h._id) === (res.body.data.id || res.body.data._id)
      );
      expect(found).toBeDefined();
    });
  });
});
