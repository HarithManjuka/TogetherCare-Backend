// tests/regression/system_regression.test.js
/**
 * TogetherCare End-to-End System Regression Test Suite
 * 
 * Purpose: Ensures that newly introduced Sprint 4 features (real-time messaging,
 * voice notes US-411, and schedule conflict prevention US-402) have not caused regressions
 * across any core system modules or other group members' components (Admin, Elderly, Volunteer, Caregiver).
 */

const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../../server');
const User = require('../../models/User');
const HelpRequest = require('../../models/HelpRequest');
const Message = require('../../models/Message');
const Notification = require('../../models/Notification');
require('../setup');

jest.setTimeout(120000);

describe('TogetherCare Full System Regression Test Suite', () => {
  let adminUser, adminToken;
  let caregiverUser, caregiverToken;
  let elderlyUser, elderlyToken;
  let volunteerUser, volunteerToken;

  const commonAddress = {
    streetAddress: '10 Galle Road',
    city: 'Colombo',
    postalCode: '00300',
    district: 'Colombo',
    province: 'Western',
  };

  const createToken = (user) => {
    return jwt.sign(
      { id: user._id, role: user.role, customId: user.customId },
      process.env.JWT_SECRET || 'test_jwt_secret_key_1234567890',
      { expiresIn: '30d' }
    );
  };

  beforeEach(async () => {
    const timestamp = Date.now();

    // 1. Admin User
    adminUser = await User.create({
      firstName: 'Admin',
      lastName: 'System',
      email: `admin.${timestamp}@togethercare.lk`,
      password: 'Password123!',
      phone: '0701111111',
      role: 'admin',
      customId: `ADM-${timestamp.toString().slice(-4)}`,
      dateOfBirth: '1980-01-01',
      gender: 'male',
      address: commonAddress,
    });
    adminToken = createToken(adminUser);

    // 2. Elderly User
    elderlyUser = await User.create({
      firstName: 'Kamal',
      lastName: 'Perera',
      email: `kamal.${timestamp}@togethercare.lk`,
      password: 'Password123!',
      phone: '0711111111',
      role: 'elderly',
      customId: `ELD-${timestamp.toString().slice(-4)}`,
      dateOfBirth: '1952-05-15',
      gender: 'male',
      address: commonAddress,
    });
    elderlyToken = createToken(elderlyUser);

    // 3. Caregiver User
    caregiverUser = await User.create({
      firstName: 'Sunil',
      lastName: 'Perera',
      email: `sunil.${timestamp}@togethercare.lk`,
      password: 'Password123!',
      phone: '0772222222',
      role: 'caregiver',
      caregiverType: 'family_member',
      customId: `CG-${timestamp.toString().slice(-4)}`,
      dateOfBirth: '1982-10-20',
      gender: 'male',
      address: commonAddress,
    });
    caregiverToken = createToken(caregiverUser);

    // 4. Volunteer User
    volunteerUser = await User.create({
      firstName: 'Chathuri',
      lastName: 'Silva',
      email: `chathuri.${timestamp}@togethercare.lk`,
      password: 'Password123!',
      phone: '0763333333',
      role: 'volunteer',
      volunteerIdType: 'NIC',
      volunteerIdNumber: '961234567V',
      customId: `VOL-${timestamp.toString().slice(-4)}`,
      dateOfBirth: '1996-03-22',
      gender: 'female',
      address: commonAddress,
    });
    volunteerToken = createToken(volunteerUser);
  });

  // ==============================================================
  // REGRESSION 1: AUTHENTICATION, RBAC & API GATEWAY STABILITY
  // ==============================================================
  describe('Regression Module 1: Auth & RBAC Security Boundaries', () => {
    it('should reject unauthenticated requests to protected endpoints', async () => {
      const res = await request(app).get('/api/messages/conversations');
      expect(res.statusCode).toBe(401);
    });

    it('should prevent non-admin roles from accessing admin user management', async () => {
      const res = await request(app)
        .get('/api/admin/users')
        .set('Authorization', `Bearer ${caregiverToken}`);

      expect([401, 403]).toContain(res.statusCode);
    });

    it('should allow admin role access to admin user dashboard endpoints', async () => {
      const res = await request(app)
        .get('/api/admin/users')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });

  // ==============================================================
  // REGRESSION 2: CAREGIVER-DEPENDENT LINKING & APPROVAL WORKFLOW
  // ==============================================================
  describe('Regression Module 2: Family Dependent Linkage Workflow', () => {
    it('should complete handshake: caregiver requests link and senior accepts', async () => {
      // Step 1: Caregiver sends link request
      const linkReqRes = await request(app)
        .post('/api/caregiver/dependents/request-link')
        .set('Authorization', `Bearer ${caregiverToken}`)
        .send({
          elderlyId: elderlyUser._id,
          relationship: 'Father',
        });

      expect(linkReqRes.statusCode).toBe(200);
      expect(linkReqRes.body.success).toBe(true);

      // Step 2: Senior accepts link request
      const acceptRes = await request(app)
        .post('/api/caregiver/dependents/respond-link')
        .set('Authorization', `Bearer ${elderlyToken}`)
        .send({
          caregiverId: caregiverUser._id,
          action: 'accept',
        });

      expect(acceptRes.statusCode).toBe(200);
      expect(acceptRes.body.success).toBe(true);

      // Step 3: Verify linked senior shows in caregiver dependent list
      const depRes = await request(app)
        .get('/api/caregiver/dependents')
        .set('Authorization', `Bearer ${caregiverToken}`);

      expect(depRes.statusCode).toBe(200);
      expect(depRes.body.success).toBe(true);
      const found = depRes.body.data.find((d) => d._id.toString() === elderlyUser._id.toString());
      expect(found).toBeDefined();
    });
  });

  // ==============================================================
  // REGRESSION 3: CAREGIVER SCHEDULING & CONFLICT PREVENTION (US-402, US-404)
  // ==============================================================
  describe('Regression Module 3: Scheduling & Conflict Prevention (US-402, US-404)', () => {
    let taskMorning, taskOverlapping, taskAfternoon;

    beforeEach(async () => {
      // Morning task: 10:00 AM
      taskMorning = await HelpRequest.create({
        caregiverId: adminUser._id,
        elderlyId: elderlyUser._id,
        serviceType: 'Grocery',
        date: '2026-11-20',
        time: '10:00 AM',
        location: 'Colombo 03',
        status: 'searching',
      });

      // Overlapping task: 10:30 AM (conflict: within 90 minutes)
      taskOverlapping = await HelpRequest.create({
        caregiverId: adminUser._id,
        elderlyId: elderlyUser._id,
        serviceType: 'Companionship',
        date: '2026-11-20',
        time: '10:30 AM',
        location: 'Colombo 05',
        status: 'searching',
      });

      // Afternoon task: 02:30 PM (> 90 minutes, no conflict)
      taskAfternoon = await HelpRequest.create({
        caregiverId: adminUser._id,
        elderlyId: elderlyUser._id,
        serviceType: 'Medicine',
        date: '2026-11-20',
        time: '02:30 PM',
        location: 'Colombo 04',
        status: 'searching',
      });
    });

    it('should view available care assignments without errors', async () => {
      const res = await request(app)
        .get('/api/help-requests/caregiver/assignments')
        .set('Authorization', `Bearer ${caregiverToken}`);

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.length).toBeGreaterThanOrEqual(3);
    });

    it('should accept non-conflicting task and reject overlapping task within 90m (US-402)', async () => {
      // 1. Accept first task (10:00 AM)
      const accept1 = await request(app)
        .post(`/api/help-requests/caregiver/assignments/${taskMorning._id}/accept`)
        .set('Authorization', `Bearer ${caregiverToken}`)
        .send({ assignmentType: 'help_request' });

      expect(accept1.statusCode).toBe(200);
      expect(accept1.body.success).toBe(true);

      // 2. Attempt to accept overlapping task (10:30 AM) -> Must return 409 Conflict
      const conflictRes = await request(app)
        .post(`/api/help-requests/caregiver/assignments/${taskOverlapping._id}/accept`)
        .set('Authorization', `Bearer ${caregiverToken}`)
        .send({ assignmentType: 'help_request' });

      expect(conflictRes.statusCode).toBe(409);
      expect(conflictRes.body.conflict).toBe(true);
      expect(conflictRes.body.message).toContain('Schedule conflict detected');

      // 3. Accept afternoon task (02:30 PM) -> Must succeed
      const accept3 = await request(app)
        .post(`/api/help-requests/caregiver/assignments/${taskAfternoon._id}/accept`)
        .set('Authorization', `Bearer ${caregiverToken}`)
        .send({ assignmentType: 'help_request' });

      expect(accept3.statusCode).toBe(200);
      expect(accept3.body.success).toBe(true);
    });

    it('should retrieve upcoming care visits across dependents (US-404)', async () => {
      // Link dependent first
      await User.findByIdAndUpdate(caregiverUser._id, {
        $addToSet: { linkedElderlyProfiles: elderlyUser._id },
      });

      // Accept taskMorning
      await request(app)
        .post(`/api/help-requests/caregiver/assignments/${taskMorning._id}/accept`)
        .set('Authorization', `Bearer ${caregiverToken}`)
        .send({ assignmentType: 'help_request' });

      const visitsRes = await request(app)
        .get('/api/caregiver/dependents/upcoming-visits')
        .set('Authorization', `Bearer ${caregiverToken}`);

      expect(visitsRes.statusCode).toBe(200);
      expect(visitsRes.body.success).toBe(true);
      expect(Array.isArray(visitsRes.body.data)).toBe(true);
    });
  });

  // ==============================================================
  // REGRESSION 4: MESSAGING, VOICE NOTES & NOTIFICATION DISPATCH (US-403, US-411)
  // ==============================================================
  describe('Regression Module 4: Real-Time Messaging & Voice Notes (US-403, US-411)', () => {
    it('should search registered contact by Sri Lankan mobile number', async () => {
      const searchRes = await request(app)
        .get('/api/messages/contacts/search?phone=0711111111')
        .set('Authorization', `Bearer ${caregiverToken}`);

      expect(searchRes.statusCode).toBe(200);
      expect(searchRes.body.success).toBe(true);
      expect(searchRes.body.data.firstName).toBe('Kamal');
    });

    it('should send text message and create in-app notification', async () => {
      const sendRes = await request(app)
        .post('/api/messages')
        .set('Authorization', `Bearer ${caregiverToken}`)
        .send({
          recipientId: elderlyUser._id,
          text: 'Hello Father, your medicine has been ordered.',
          messageType: 'text',
        });

      expect(sendRes.statusCode).toBe(201);
      expect(sendRes.body.success).toBe(true);
      expect(sendRes.body.data.text).toBe('Hello Father, your medicine has been ordered.');

      // Check notification created for recipient
      const notif = await Notification.findOne({
        recipient: elderlyUser._id,
        type: 'message',
      });
      expect(notif).toBeDefined();
      expect(notif.title).toContain('Sunil');
    });

    it('should upload voice note and send voice message with duration (US-411)', async () => {
      // 1. Upload audio
      const uploadRes = await request(app)
        .post('/api/messages/upload-audio')
        .set('Authorization', `Bearer ${caregiverToken}`)
        .send({
          audioBase64: 'data:audio/m4a;base64,AAAAHGZ0eXBNNEEgAAAAAE00QSBtcDQyaXNvbQ==',
          duration: 7,
        });

      expect(uploadRes.statusCode).toBe(200);
      expect(uploadRes.body.success).toBe(true);
      const audioUrl = uploadRes.body.data.audioUrl;

      // 2. Send voice message
      const sendRes = await request(app)
        .post('/api/messages')
        .set('Authorization', `Bearer ${caregiverToken}`)
        .send({
          recipientId: elderlyUser._id,
          messageType: 'voice',
          audioUrl,
          audioDuration: 7,
          text: '🎤 Voice note (7s)',
        });

      expect(sendRes.statusCode).toBe(201);
      expect(sendRes.body.data.messageType).toBe('voice');
      expect(sendRes.body.data.audioDuration).toBe(7);

      // 3. Thread verification
      const threadRes = await request(app)
        .get(`/api/messages/${elderlyUser._id}`)
        .set('Authorization', `Bearer ${caregiverToken}`);

      expect(threadRes.statusCode).toBe(200);
      const voiceInThread = threadRes.body.data.find((m) => m.messageType === 'voice');
      expect(voiceInThread).toBeDefined();
      expect(voiceInThread.audioUrl).toBe(audioUrl);
    });

    it('should mark message thread as read and update read status', async () => {
      // Elderly sends message to caregiver
      await request(app)
        .post('/api/messages')
        .set('Authorization', `Bearer ${elderlyToken}`)
        .send({
          recipientId: caregiverUser._id,
          text: 'Thank you Sunil.',
        });

      // Caregiver marks thread as read
      const readRes = await request(app)
        .patch(`/api/messages/${elderlyUser._id}/read`)
        .set('Authorization', `Bearer ${caregiverToken}`);

      expect(readRes.statusCode).toBe(200);
      expect(readRes.body.success).toBe(true);

      const msg = await Message.findOne({ sender: elderlyUser._id, recipient: caregiverUser._id });
      expect(msg.isRead).toBe(true);
    });
  });

  // ==============================================================
  // REGRESSION 5: VOLUNTEER & NOTIFICATION ISOLATION
  // ==============================================================
  describe('Regression Module 5: Multi-Role System Isolation', () => {
    it('should ensure notifications count correctly across roles without cross-talk', async () => {
      // Create notification for volunteer
      await Notification.create({
        recipient: volunteerUser._id,
        sender: adminUser._id,
        type: 'general',
        title: 'Volunteer Approved',
        message: 'Your volunteer application has been approved.',
      });

      // Check volunteer unread count
      const volRes = await request(app)
        .get('/api/notifications/unread-count')
        .set('Authorization', `Bearer ${volunteerToken}`);

      expect(volRes.statusCode).toBe(200);
      expect(volRes.body.unreadCount).toBe(1);

      // Caregiver unread count should be 0
      const cgRes = await request(app)
        .get('/api/notifications/unread-count')
        .set('Authorization', `Bearer ${caregiverToken}`);

      expect(cgRes.statusCode).toBe(200);
      expect(cgRes.body.unreadCount).toBe(0);
    });
  });
});
