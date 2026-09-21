// tests/IT23818620/messaging_contacts.test.js
const request = require('supertest');
const app = require('../../server');
const User = require('../../models/User');
const Message = require('../../models/Message');
require('../setup');

jest.setTimeout(120000);

const jwt = require('jsonwebtoken');

describe('IT23818620: Real-Time Messaging & Contact Management Integration Tests', () => {
  let caregiverToken;
  let caregiverUser;
  let seniorToken;
  let seniorUser;
  let volunteerToken;
  let volunteerUser;

  const commonAddress = {
    streetAddress: '45 Galle Road',
    city: 'Colombo',
    postalCode: '00300',
    district: 'Colombo',
    province: 'Western',
  };

  beforeEach(async () => {
    // 1. Create Senior (Phone: 0711111111)
    seniorUser = await User.create({
      firstName: 'Nimal',
      lastName: 'Perera',
      email: `nimal.${Date.now()}@example.com`,
      password: 'Password123!',
      phone: '0711111111',
      role: 'elderly',
      customId: 'ELD-TEST-001',
      dateOfBirth: '1955-04-10',
      gender: 'male',
      address: commonAddress,
    });
    seniorToken = jwt.sign(
      { id: seniorUser._id, role: seniorUser.role, customId: seniorUser.customId },
      process.env.JWT_SECRET || 'test_jwt_secret_key_1234567890',
      { expiresIn: '30d' }
    );

    // 2. Create Caregiver (Phone: 0772222222)
    caregiverUser = await User.create({
      firstName: 'Sunil',
      lastName: 'Perera',
      email: `sunil.${Date.now()}@example.com`,
      password: 'Password123!',
      phone: '0772222222',
      role: 'caregiver',
      caregiverType: 'family_member',
      customId: 'CG-TEST-001',
      dateOfBirth: '1985-08-15',
      gender: 'male',
      address: commonAddress,
    });
    caregiverToken = jwt.sign(
      { id: caregiverUser._id, role: caregiverUser.role, customId: caregiverUser.customId },
      process.env.JWT_SECRET || 'test_jwt_secret_key_1234567890',
      { expiresIn: '30d' }
    );

    // 3. Create Volunteer (Phone: 0763333333)
    volunteerUser = await User.create({
      firstName: 'Chathuri',
      lastName: 'Fernando',
      email: `chathuri.${Date.now()}@example.com`,
      password: 'Password123!',
      phone: '0763333333',
      role: 'volunteer',
      customId: 'VOL-TEST-001',
      volunteerIdType: 'NIC',
      volunteerIdNumber: '951234567V',
      dateOfBirth: '1995-12-01',
      gender: 'female',
      address: commonAddress,
    });
    volunteerToken = jwt.sign(
      { id: volunteerUser._id, role: volunteerUser.role, customId: volunteerUser.customId },
      process.env.JWT_SECRET || 'test_jwt_secret_key_1234567890',
      { expiresIn: '30d' }
    );
  });

  // ==========================================
  // CONTACT SEARCH BY MOBILE NUMBER
  // ==========================================
  describe('Contact Search by Mobile Number', () => {
    it('should find registered senior by mobile number with leading 0 (0711111111)', async () => {
      const res = await request(app)
        .get('/api/messages/contacts/search?phone=0711111111')
        .set('Authorization', `Bearer ${caregiverToken}`);

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.firstName).toBe('Nimal');
      expect(res.body.data.role).toBe('elderly');
      expect(res.body.data.phone).toBe('0711111111');
      expect(res.body.data.isAlreadyContact).toBe(false);
    });

    it('should find registered user by mobile number with +94 country code (+94763333333)', async () => {
      const res = await request(app)
        .get('/api/messages/contacts/search?phone=%2B94763333333')
        .set('Authorization', `Bearer ${caregiverToken}`);

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.firstName).toBe('Chathuri');
      expect(res.body.data.role).toBe('volunteer');
    });

    it('should return 400 when attempting to search own mobile number', async () => {
      const res = await request(app)
        .get('/api/messages/contacts/search?phone=0772222222')
        .set('Authorization', `Bearer ${caregiverToken}`);

      expect(res.statusCode).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toContain('cannot add your own mobile number');
    });

    it('should return 404 when mobile number is not registered', async () => {
      const res = await request(app)
        .get('/api/messages/contacts/search?phone=0779999999')
        .set('Authorization', `Bearer ${caregiverToken}`);

      expect(res.statusCode).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toContain('No registered user found');
    });
  });

  // ==========================================
  // ADD & MANAGE CONTACTS
  // ==========================================
  describe('Add & Manage Contacts', () => {
    it('should add registered user to contacts by mobile number with optional nickname', async () => {
      const addRes = await request(app)
        .post('/api/messages/contacts')
        .set('Authorization', `Bearer ${caregiverToken}`)
        .send({
          phone: '0711111111',
          nickname: 'Father',
        });

      expect(addRes.statusCode).toBe(201);
      expect(addRes.body.success).toBe(true);
      expect(addRes.body.data.nickname).toBe('Father');
      expect(addRes.body.data.user.firstName).toBe('Nimal');

      // Verify contact shows up in GET /api/messages/contacts
      const getRes = await request(app)
        .get('/api/messages/contacts')
        .set('Authorization', `Bearer ${caregiverToken}`);

      expect(getRes.statusCode).toBe(200);
      expect(getRes.body.success).toBe(true);
      expect(getRes.body.data.length).toBeGreaterThan(0);
      const added = getRes.body.data.find((c) => c._id.toString() === seniorUser._id.toString());
      expect(added).toBeDefined();
      expect(added.nickname).toBe('Father');
      expect(added.isSavedContact).toBe(true);
    });

    it('should reject adding the same contact twice', async () => {
      // 1. First add
      await request(app)
        .post('/api/messages/contacts')
        .set('Authorization', `Bearer ${caregiverToken}`)
        .send({ phone: '0711111111' });

      // 2. Second add (duplicate)
      const dupRes = await request(app)
        .post('/api/messages/contacts')
        .set('Authorization', `Bearer ${caregiverToken}`)
        .send({ phone: '0711111111' });

      expect(dupRes.statusCode).toBe(400);
      expect(dupRes.body.success).toBe(false);
      expect(dupRes.body.message).toContain('already in your contacts list');
    });

    it('should remove a contact from the contacts list', async () => {
      // Add contact
      await request(app)
        .post('/api/messages/contacts')
        .set('Authorization', `Bearer ${caregiverToken}`)
        .send({ phone: '0763333333' });

      // Remove contact
      const deleteRes = await request(app)
        .delete(`/api/messages/contacts/${volunteerUser._id}`)
        .set('Authorization', `Bearer ${caregiverToken}`);

      expect(deleteRes.statusCode).toBe(200);
      expect(deleteRes.body.success).toBe(true);
      expect(deleteRes.body.message).toContain('removed successfully');

      // Verify not in saved contacts
      const getRes = await request(app)
        .get('/api/messages/contacts')
        .set('Authorization', `Bearer ${caregiverToken}`);

      const found = getRes.body.data.find(
        (c) => c._id.toString() === volunteerUser._id.toString() && c.isSavedContact
      );
      expect(found).toBeUndefined();
    });
  });

  // ==========================================
  // REAL-TIME MESSAGING & THREAD OPERATIONS
  // ==========================================
  describe('Messaging & Real-Time Endpoints', () => {
    it('should send a text message and retrieve populated conversation', async () => {
      const sendRes = await request(app)
        .post('/api/messages')
        .set('Authorization', `Bearer ${caregiverToken}`)
        .send({
          recipientId: seniorUser._id,
          text: 'Hello Father, are you feeling better today?',
          messageType: 'text',
        });

      expect(sendRes.statusCode).toBe(201);
      expect(sendRes.body.success).toBe(true);
      expect(sendRes.body.data.text).toBe('Hello Father, are you feeling better today?');
      expect(sendRes.body.data.recipient.phone).toBe('0711111111');

      // Fetch messages thread
      const threadRes = await request(app)
        .get(`/api/messages/${seniorUser._id}`)
        .set('Authorization', `Bearer ${caregiverToken}`);

      expect(threadRes.statusCode).toBe(200);
      expect(threadRes.body.success).toBe(true);
      expect(threadRes.body.data).toHaveLength(1);
    });

    it('should mark message thread as read', async () => {
      // Senior sends a message to caregiver
      await request(app)
        .post('/api/messages')
        .set('Authorization', `Bearer ${seniorToken}`)
        .send({
          recipientId: caregiverUser._id,
          text: 'Yes, thank you Sunil.',
        });

      // Caregiver marks thread as read
      const readRes = await request(app)
        .patch(`/api/messages/${seniorUser._id}/read`)
        .set('Authorization', `Bearer ${caregiverToken}`);

      expect(readRes.statusCode).toBe(200);
      expect(readRes.body.success).toBe(true);

      // Verify message isRead is true
      const msg = await Message.findOne({ sender: seniorUser._id, recipient: caregiverUser._id });
      expect(msg.isRead).toBe(true);
    });
  });
});
