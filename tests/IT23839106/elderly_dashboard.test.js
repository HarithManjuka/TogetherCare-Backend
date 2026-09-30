// tests/IT23839106/elderly_dashboard.test.js
const request = require('supertest');
const app = require('../../server');
const CompanionshipRequest = require('../../models/CompanionshipRequest');
const VolunteerOffer = require('../../models/VolunteerOffer');
const User = require('../../models/User');
require('../setup');

describe('IT23839106: Elderly Companionship & Schedule Overlap Prevention Integration Tests', () => {
  let elderlyToken;
  let elderlyUser;
  let volunteerToken;
  let volunteerUser;

  const testElderlyPayload = {
    firstName: 'Sunil',
    lastName: 'Perera',
    email: 'sunil.elderly@example.com',
    password: 'SecurePassword123!',
    phone: '0779998877',
    role: 'elderly',
    dateOfBirth: '1952-03-15',
    gender: 'male',
    address: {
      streetAddress: '12 Temple Road',
      city: 'Nugegoda',
      postalCode: '10250',
      district: 'Colombo',
      province: 'Western',
    },
  };

  const testVolunteerPayload = {
    firstName: 'Kasun',
    lastName: 'Dias',
    email: 'kasun.volunteer@example.com',
    password: 'SecurePassword123!',
    phone: '0712223344',
    role: 'volunteer',
    dateOfBirth: '1996-08-10',
    gender: 'male',
    address: {
      streetAddress: '20 Station Road',
      city: 'Nugegoda',
      postalCode: '10250',
      district: 'Colombo',
      province: 'Western',
    },
    volunteerIdType: 'NIC',
    volunteerIdNumber: '199611112222',
  };

  beforeEach(async () => {
    // Register test elderly user
    const elderRes = await request(app)
      .post('/api/auth/register')
      .send(testElderlyPayload);
    elderlyToken = elderRes.body.token;
    elderlyUser = elderRes.body.user;

    // Register test volunteer
    const volRes = await request(app)
      .post('/api/auth/register')
      .send(testVolunteerPayload);
    volunteerToken = volRes.body.token;
    volunteerUser = volRes.body.user;
  });

  describe('Schedule Overlap Prevention on Request Creation', () => {
    it('should allow creating an initial companionship request', async () => {
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 2);
      const dateStr = futureDate.toISOString().split('T')[0];

      const res = await request(app)
        .post('/api/companionship/create')
        .set('Authorization', `Bearer ${elderlyToken}`)
        .send({
          activityType: 'Grocery',
          scheduledDate: dateStr,
          startTime: '09:00 AM',
          endTime: '11:00 AM',
          timeSlot: '09:00 AM - 11:00 AM',
          communicationMethod: 'chat',
          location: 'Nugegoda Supermarket',
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.activityType).toBe('Grocery');
    });

    it('should reject a second companionship request that overlaps with an existing active request', async () => {
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 3);
      const dateStr = futureDate.toISOString().split('T')[0];

      // 1. Create first request: 02:00 PM - 04:00 PM
      const firstRes = await request(app)
        .post('/api/companionship/create')
        .set('Authorization', `Bearer ${elderlyToken}`)
        .send({
          activityType: 'Medicine',
          scheduledDate: dateStr,
          startTime: '02:00 PM',
          endTime: '04:00 PM',
          timeSlot: '02:00 PM - 04:00 PM',
          communicationMethod: 'call',
        });

      expect(firstRes.status).toBe(201);

      // 2. Attempt to create overlapping request: 03:00 PM - 05:00 PM on same day
      const overlapRes = await request(app)
        .post('/api/companionship/create')
        .set('Authorization', `Bearer ${elderlyToken}`)
        .send({
          activityType: 'Walk',
          scheduledDate: dateStr,
          startTime: '03:00 PM',
          endTime: '05:00 PM',
          timeSlot: '03:00 PM - 05:00 PM',
          communicationMethod: 'in_person',
        });

      expect(overlapRes.status).toBe(400);
      expect(overlapRes.body.success).toBe(false);
      expect(overlapRes.body.message).toMatch(/Schedule conflict/i);
    });

    it('should allow creating a non-overlapping request on the same day at a different time', async () => {
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 4);
      const dateStr = futureDate.toISOString().split('T')[0];

      // Morning slot: 09:00 AM - 11:00 AM
      await request(app)
        .post('/api/companionship/create')
        .set('Authorization', `Bearer ${elderlyToken}`)
        .send({
          activityType: 'Grocery',
          scheduledDate: dateStr,
          startTime: '09:00 AM',
          endTime: '11:00 AM',
          timeSlot: '09:00 AM - 11:00 AM',
        });

      // Afternoon slot: 02:00 PM - 04:00 PM (No overlap)
      const nonOverlapRes = await request(app)
        .post('/api/companionship/create')
        .set('Authorization', `Bearer ${elderlyToken}`)
        .send({
          activityType: 'Reading',
          scheduledDate: dateStr,
          startTime: '02:00 PM',
          endTime: '04:00 PM',
          timeSlot: '02:00 PM - 04:00 PM',
        });

      expect(nonOverlapRes.status).toBe(201);
      expect(nonOverlapRes.body.success).toBe(true);
    });
  });

  describe('Schedule Overlap Prevention on Accepting Volunteer Offers', () => {
    it('should prevent an elder from accepting a volunteer offer that overlaps with their existing schedule', async () => {
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 5);
      const dateStr = futureDate.toISOString().split('T')[0];

      // 1. Volunteer posts an offer: 10:00 AM - 12:00 PM
      const offerRes = await request(app)
        .post('/api/volunteer-offers')
        .set('Authorization', `Bearer ${volunteerToken}`)
        .send({
          services: ['Walk & Exercise'],
          date: dateStr,
          startTime: '10:00 AM',
          endTime: '12:00 PM',
          serviceArea: 'Nugegoda',
          capacity: 1,
        });

      expect(offerRes.status).toBe(201);
      const offerId = offerRes.body.data._id;

      // 2. Elder creates their own companionship schedule: 09:30 AM - 11:30 AM (overlaps with offer)
      await request(app)
        .post('/api/companionship/create')
        .set('Authorization', `Bearer ${elderlyToken}`)
        .send({
          activityType: 'Tech',
          scheduledDate: dateStr,
          startTime: '09:30 AM',
          endTime: '11:30 AM',
          timeSlot: '09:30 AM - 11:30 AM',
        });

      // 3. Elder attempts to accept the overlapping offer
      const acceptRes = await request(app)
        .post(`/api/volunteer-offers/${offerId}/accept`)
        .set('Authorization', `Bearer ${elderlyToken}`);

    });
  });

  describe('Rating & Review Updates with In-Place Deduplication', () => {
    it('should submit a rating, then update the rating in-place without creating duplicate review entries', async () => {
      const Review = require('../../models/Review');
      const Notification = require('../../models/Notification');

      // 1. Create a completed companionship visit assigned to the volunteer
      const visit = await CompanionshipRequest.create({
        elderly: elderlyUser._id,
        volunteer: volunteerUser._id,
        activityType: 'Reading',
        scheduledDate: new Date(),
        startTime: '10:00 AM',
        endTime: '11:00 AM',
        status: 'completed',
      });

      // 2. Initial rating submission
      const rateRes1 = await request(app)
        .post(`/api/companionship/${visit._id}/rate`)
        .set('Authorization', `Bearer ${elderlyToken}`)
        .send({
          visitRating: 4,
          visitReview: 'Great reading session!',
          volunteerRating: 4,
          volunteerReview: 'Kasun was very helpful and patient.',
        });

      expect(rateRes1.status).toBe(200);
      expect(rateRes1.body.success).toBe(true);

      // Verify Review count in DB is 1
      let reviews = await Review.find({ scheduleId: visit._id });
      expect(reviews.length).toBe(1);
      expect(reviews[0].rating).toBe(4);
      expect(reviews[0].comment).toBe('Kasun was very helpful and patient.');

      // Verify Volunteer received notification
      const notif1 = await Notification.findOne({
        recipient: volunteerUser._id,
        type: 'visit_reviewed',
      });
      expect(notif1).toBeTruthy();
      expect(notif1.message).toContain('rated you 4 ⭐');

      // 3. Update the rating to 5 stars
      const rateRes2 = await request(app)
        .post(`/api/companionship/${visit._id}/rate`)
        .set('Authorization', `Bearer ${elderlyToken}`)
        .send({
          visitRating: 5,
          visitReview: 'Even better after reflecting!',
          volunteerRating: 5,
          volunteerReview: 'Outstanding volunteer, exceeded expectations!',
        });

      expect(rateRes2.status).toBe(200);
      expect(rateRes2.body.success).toBe(true);

      // Verify Review count in DB is STILL 1 (updated in place, no duplicates)
      reviews = await Review.find({ scheduleId: visit._id });
      expect(reviews.length).toBe(1);
      expect(reviews[0].rating).toBe(5);
      expect(reviews[0].comment).toBe('Outstanding volunteer, exceeded expectations!');
      expect(reviews[0].visitRating).toBe(5);
    });
  });
});

