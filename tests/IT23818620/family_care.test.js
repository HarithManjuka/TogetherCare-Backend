// tests/IT23818620/family_care.test.js
const request = require('supertest');
const app = require('../../server');
const User = require('../../models/User');
const HelpRequest = require('../../models/HelpRequest');
const Notification = require('../../models/Notification');
const Message = require('../../models/Message');
require('../setup');

describe('IT23818620: Family Member & Caregiver Integration Test Suite', () => {
  let familyMemberToken;
  let familyMemberUser;
  let formalCaregiverToken;
  let formalCaregiverUser;
  let seniorToken1;
  let seniorUser1;
  let seniorToken2;
  let seniorUser2;

  const commonAddress = {
    streetAddress: '123 Galle Road',
    city: 'Colombo',
    postalCode: '00300',
    district: 'Colombo',
    province: 'Western',
  };

  beforeEach(async () => {
    // 1. Create Senior 1
    const seniorRes1 = await request(app)
      .post('/api/auth/register')
      .send({
        firstName: 'Kamal',
        lastName: 'Silva',
        email: 'kamal.silva@example.com',
        password: 'Password123!',
        phone: '0711111111',
        role: 'elderly',
        dateOfBirth: '1960-01-01',
        gender: 'male',
        address: commonAddress,
        emergencyContact: {
          name: 'Amara Silva',
          phone: '0773333333',
          relationship: 'Daughter',
        },
      });
    seniorToken1 = seniorRes1.body.token;
    seniorUser1 = seniorRes1.body.user;

    // 2. Create Senior 2
    const seniorRes2 = await request(app)
      .post('/api/auth/register')
      .send({
        firstName: 'Sita',
        lastName: 'Silva',
        email: 'sita.silva@example.com',
        password: 'Password123!',
        phone: '0712222222',
        role: 'elderly',
        dateOfBirth: '1962-03-12',
        gender: 'female',
        address: commonAddress,
        emergencyContact: {
          name: 'Amara Silva',
          phone: '0773333333',
          relationship: 'Daughter',
        },
      });
    seniorToken2 = seniorRes2.body.token;
    seniorUser2 = seniorRes2.body.user;

    // 3. Create Family Member
    const familyRes = await request(app)
      .post('/api/auth/register')
      .send({
        firstName: 'Amara',
        lastName: 'Silva',
        email: 'amara.silva@example.com',
        password: 'Password123!',
        phone: '0773333333',
        role: 'caregiver',
        caregiverType: 'family_member',
        relationshipToElderly: 'Daughter',
        dateOfBirth: '1988-06-20',
        gender: 'female',
        address: commonAddress,
      });
    familyMemberToken = familyRes.body.token;
    familyMemberUser = familyRes.body.user;

    // 4. Create Formal Caregiver
    const formalRes = await request(app)
      .post('/api/auth/register')
      .send({
        firstName: 'Rohan',
        lastName: 'Perera',
        email: 'rohan.caregiver@example.com',
        password: 'Password123!',
        phone: '0774444444',
        role: 'caregiver',
        caregiverType: 'formal_caregiver',
        organizationName: 'CarePlus Lanka',
        dateOfBirth: '1985-09-15',
        gender: 'male',
        address: commonAddress,
      });
    formalCaregiverToken = formalRes.body.token;
    formalCaregiverUser = formalRes.body.user;
  });

  // ==========================================
  // SPRINT 1: Profiles, Credentials & Certifications
  // ==========================================
  describe('Sprint 1: Registration, Profiles & Certifications', () => {
    it('should register family member and formal caregiver with distinct roles & metadata', async () => {
      expect(familyMemberUser.role).toBe('caregiver');
      expect(familyMemberUser.caregiverType).toBe('family_member');
      expect(formalCaregiverUser.role).toBe('caregiver');
      expect(formalCaregiverUser.caregiverType).toBe('formal_caregiver');
    });

    it('should allow formal caregiver to add professional certifications', async () => {
      const addCertRes = await request(app)
        .post('/api/auth/certifications')
        .set('Authorization', `Bearer ${formalCaregiverToken}`)
        .send({
          title: 'Certified Nursing Assistant (CNA)',
          issuingOrganization: 'Sri Lanka Red Cross Society',
          certificateNumber: 'CNA-2024-0981',
          issueDate: '2023-05-10',
        });

      expect(addCertRes.statusCode).toBe(201);
      expect(addCertRes.body.success).toBe(true);
      expect(addCertRes.body.data).toHaveLength(1);
      expect(addCertRes.body.data[0].title).toBe('Certified Nursing Assistant (CNA)');
      expect(addCertRes.body.data[0].verificationStatus).toBe('pending');
    });

    it('should allow caregiver to delete a certification', async () => {
      const addCertRes = await request(app)
        .post('/api/auth/certifications')
        .set('Authorization', `Bearer ${formalCaregiverToken}`)
        .send({
          title: 'First Aid & CPR',
          issuingOrganization: 'St. John Ambulance',
        });

      const certId = addCertRes.body.data[0]._id;

      const deleteRes = await request(app)
        .delete(`/api/auth/certifications/${certId}`)
        .set('Authorization', `Bearer ${formalCaregiverToken}`);

      expect(deleteRes.statusCode).toBe(200);
      expect(deleteRes.body.success).toBe(true);
      expect(deleteRes.body.data).toHaveLength(0);
    });

    it('should update caregiver professional profile fields (years of experience, bio, rate)', async () => {
      const updateRes = await request(app)
        .put('/api/auth/profile')
        .set('Authorization', `Bearer ${formalCaregiverToken}`)
        .send({
          yearsOfExperience: 5,
          caregiverBio: 'Compassionate licensed caregiver specializing in geriatric care.',
          hourlyRate: 1500,
          specializations: ['Mobility Support', 'Dementia Care'],
        });

      expect(updateRes.statusCode).toBe(200);
      expect(updateRes.body.success).toBe(true);
      expect(updateRes.body.user.yearsOfExperience).toBe(5);
      expect(updateRes.body.user.hourlyRate).toBe(1500);
      expect(updateRes.body.user.specializations).toContain('Dementia Care');
    });
  });

  // ==========================================
  // SPRINT 1 & 2: Dependent Management (Elderly Permission Handshake & Multi-Senior Linking)
  // ==========================================
  describe('Sprint 1 & 2: Dependent Management & Elderly Permission Handshake', () => {
    it('should send link request to senior 1 and return pending_approval status', async () => {
      const linkRes = await request(app)
        .post('/api/dependents/link')
        .set('Authorization', `Bearer ${familyMemberToken}`)
        .send({
          seniorId: seniorUser1._id,
          relationship: 'Father',
        });

      expect(linkRes.statusCode).toBe(200);
      expect(linkRes.body.success).toBe(true);
      expect(linkRes.body.status).toBe('pending_approval');
      expect(linkRes.body.message).toContain('Awaiting senior approval');

      // Check senior received link_request notification
      const seniorNotifs = await Notification.find({ recipient: seniorUser1._id, type: 'link_request' });
      expect(seniorNotifs.length).toBeGreaterThan(0);
      expect(seniorNotifs[0].title).toContain('Link Request');
    });

    it('should allow senior to accept link request, linking accounts and notifying both parties', async () => {
      // 1. Caregiver sends link request
      await request(app)
        .post('/api/dependents/link')
        .set('Authorization', `Bearer ${familyMemberToken}`)
        .send({ seniorId: seniorUser1._id, relationship: 'Father' });

      // 2. Senior accepts link request
      const respondRes = await request(app)
        .post('/api/dependents/respond-link')
        .set('Authorization', `Bearer ${seniorToken1}`)
        .send({
          caregiverId: familyMemberUser._id,
          action: 'accept',
        });

      expect(respondRes.statusCode).toBe(200);
      expect(respondRes.body.success).toBe(true);
      expect(respondRes.body.action).toBe('accepted');

      // 3. Verify senior profile now has linkedCaregiverId
      const updatedSenior = await User.findById(seniorUser1._id);
      expect(updatedSenior.linkedCaregiverId.toString()).toBe(familyMemberUser._id.toString());
      expect(updatedSenior.pendingCaregiverRequests).toHaveLength(0);

      // 4. Verify caregiver profile has senior in linkedElderlyProfiles
      const updatedCaregiver = await User.findById(familyMemberUser._id);
      expect(updatedCaregiver.linkedElderlyProfiles.map((id) => id.toString())).toContain(seniorUser1._id.toString());

      // 5. Verify dual notifications were dispatched
      const caregiverNotif = await Notification.findOne({
        recipient: familyMemberUser._id,
        type: 'link_approved',
      });
      expect(caregiverNotif).not.toBeNull();
      expect(caregiverNotif.title).toContain('Accepted');

      const seniorNotif = await Notification.findOne({
        recipient: seniorUser1._id,
        type: 'link_approved',
      });
      expect(seniorNotif).not.toBeNull();
      expect(seniorNotif.title).toContain('Connected');
    });

    it('should allow senior to decline link request, notifying caregiver without linking', async () => {
      // 1. Caregiver sends link request to senior 2
      await request(app)
        .post('/api/dependents/link')
        .set('Authorization', `Bearer ${familyMemberToken}`)
        .send({ seniorId: seniorUser2._id, relationship: 'Mother' });

      // 2. Senior 2 declines link request
      const declineRes = await request(app)
        .post('/api/dependents/respond-link')
        .set('Authorization', `Bearer ${seniorToken2}`)
        .send({
          caregiverId: familyMemberUser._id,
          action: 'reject',
        });

      expect(declineRes.statusCode).toBe(200);
      expect(declineRes.body.success).toBe(true);
      expect(declineRes.body.action).toBe('rejected');

      // 3. Verify senior 2 is NOT linked
      const seniorDoc = await User.findById(seniorUser2._id);
      expect(seniorDoc.linkedCaregiverId).toBeNull();
      expect(seniorDoc.pendingCaregiverRequests).toHaveLength(0);

      // 4. Verify caregiver received decline notification
      const declineNotif = await Notification.findOne({
        recipient: familyMemberUser._id,
        type: 'link_rejected',
      });
      expect(declineNotif).not.toBeNull();
      expect(declineNotif.title).toContain('Declined');
    });

    it('should support linking multiple seniors under a single family member account with senior approvals', async () => {
      // Link Senior 1 (Father)
      await request(app)
        .post('/api/dependents/link')
        .set('Authorization', `Bearer ${familyMemberToken}`)
        .send({ seniorId: seniorUser1._id, relationship: 'Father' });
      await request(app)
        .post('/api/dependents/respond-link')
        .set('Authorization', `Bearer ${seniorToken1}`)
        .send({ caregiverId: familyMemberUser._id, action: 'accept' });

      // Link Senior 2 (Mother)
      await request(app)
        .post('/api/dependents/link')
        .set('Authorization', `Bearer ${familyMemberToken}`)
        .send({ seniorId: seniorUser2._id, relationship: 'Mother' });
      await request(app)
        .post('/api/dependents/respond-link')
        .set('Authorization', `Bearer ${seniorToken2}`)
        .send({ caregiverId: familyMemberUser._id, action: 'accept' });

      // Fetch all dependents
      const getRes = await request(app)
        .get('/api/dependents')
        .set('Authorization', `Bearer ${familyMemberToken}`);

      expect(getRes.statusCode).toBe(200);
      expect(getRes.body.success).toBe(true);
      expect(getRes.body.data).toHaveLength(2);
      const names = getRes.body.data.map((d) => d.firstName);
      expect(names).toContain('Kamal');
      expect(names).toContain('Sita');
    });

    it('should allow family member or senior to unlink an elderly dependent', async () => {
      // Link Senior 1
      await request(app)
        .post('/api/dependents/link')
        .set('Authorization', `Bearer ${familyMemberToken}`)
        .send({ seniorId: seniorUser1._id, relationship: 'Father' });
      await request(app)
        .post('/api/dependents/respond-link')
        .set('Authorization', `Bearer ${seniorToken1}`)
        .send({ caregiverId: familyMemberUser._id, action: 'accept' });

      const unlinkRes = await request(app)
        .post('/api/dependents/unlink')
        .set('Authorization', `Bearer ${familyMemberToken}`)
        .send({ seniorId: seniorUser1._id });

      expect(unlinkRes.statusCode).toBe(200);
      expect(unlinkRes.body.success).toBe(true);

      // Verify list is now empty
      const getRes = await request(app)
        .get('/api/dependents')
        .set('Authorization', `Bearer ${familyMemberToken}`);
      expect(getRes.body.data).toHaveLength(0);
    });
  });

  // ==========================================
  // SPRINT 2: SOS Alerts & Notifications
  // ==========================================
  describe('Sprint 2: SOS Alerts & Family Notifications', () => {
    beforeEach(async () => {
      // Link senior 1 to family member with permission
      await request(app)
        .post('/api/dependents/link')
        .set('Authorization', `Bearer ${familyMemberToken}`)
        .send({ seniorId: seniorUser1._id, relationship: 'Father' });
      await request(app)
        .post('/api/dependents/respond-link')
        .set('Authorization', `Bearer ${seniorToken1}`)
        .send({ caregiverId: familyMemberUser._id, action: 'accept' });
    });

    it('should trigger SOS from senior and dispatch emergency notification to linked family member', async () => {
      const sosRes = await request(app)
        .post('/api/emergency/sos')
        .set('Authorization', `Bearer ${seniorToken1}`)
        .send({
          location: { latitude: 6.9271, longitude: 79.8612, address: 'Colombo 07' },
          notes: 'Dizziness and chest pain',
        });

      expect(sosRes.statusCode).toBe(201);
      expect(sosRes.body.success).toBe(true);

      // Family member checks active SOS
      const activeSOSRes = await request(app)
        .get('/api/emergency/active')
        .set('Authorization', `Bearer ${familyMemberToken}`);

      expect(activeSOSRes.statusCode).toBe(200);
      expect(activeSOSRes.body.success).toBe(true);
      expect(activeSOSRes.body.data).not.toBeNull();
      expect(activeSOSRes.body.data.status).toBe('active');

      // Family member checks notifications
      const notifRes = await request(app)
        .get('/api/notifications')
        .set('Authorization', `Bearer ${familyMemberToken}`);

      expect(notifRes.statusCode).toBe(200);
      expect(notifRes.body.success).toBe(true);
      expect(notifRes.body.data.length).toBeGreaterThan(0);
      const sosNotif = notifRes.body.data.find((n) => n.type === 'sos_alert');
      expect(sosNotif).toBeDefined();
      expect(sosNotif.title).toContain('EMERGENCY SOS ALERT');
    });

    it('should allow marking notifications as read', async () => {
      // Create a test notification
      const notif = await Notification.create({
        recipient: familyMemberUser._id,
        sender: seniorUser1._id,
        type: 'general',
        title: 'Task reminder',
        message: 'Senior took morning medication',
      });

      const readRes = await request(app)
        .patch(`/api/notifications/${notif._id}/read`)
        .set('Authorization', `Bearer ${familyMemberToken}`);

      expect(readRes.statusCode).toBe(200);
      expect(readRes.body.success).toBe(true);
      expect(readRes.body.data.isRead).toBe(true);
    });
  });

  // ==========================================
  // SPRINT 3: Caregiver Assignments, Completed Visits & Senior Monitoring
  // ==========================================
  describe('Sprint 3: Caregiver Assignments, Completed Visits & Senior Monitoring', () => {
    let helpRequest;

    beforeEach(async () => {
      await request(app)
        .post('/api/dependents/link')
        .set('Authorization', `Bearer ${familyMemberToken}`)
        .send({ seniorId: seniorUser1._id, relationship: 'Father' });
      await request(app)
        .post('/api/dependents/respond-link')
        .set('Authorization', `Bearer ${seniorToken1}`)
        .send({ caregiverId: familyMemberUser._id, action: 'accept' });

      // Create a help request for Senior 1
      helpRequest = await HelpRequest.create({
        caregiverId: familyMemberUser._id,
        elderlyId: seniorUser1._id,
        serviceType: 'Medicine',
        date: '2026-10-20',
        time: '10:00 AM',
        location: 'Kandy Road, Colombo',
        status: 'searching',
      });
    });

    it('should allow caregiver to view available care assignments', async () => {
      const res = await request(app)
        .get('/api/help-requests/caregiver/assignments')
        .set('Authorization', `Bearer ${formalCaregiverToken}`);

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.length).toBeGreaterThan(0);
      const item = res.body.data.find((a) => a._id.toString() === helpRequest._id.toString());
      expect(item).toBeDefined();
      expect(item.serviceType).toBe('Medicine');
    });

    it('should allow family member to monitor senior tasks and activities', async () => {
      const res = await request(app)
        .get(`/api/dependents/${seniorUser1._id}/activities`)
        .set('Authorization', `Bearer ${familyMemberToken}`);

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.helpRequests).toBeDefined();
      expect(res.body.data.helpRequests).toHaveLength(1);
      expect(res.body.data.helpRequests[0]._id.toString()).toBe(helpRequest._id.toString());
    });

    it('should allow caregiver to track completed visits', async () => {
      // Mark assignment as completed by formalCaregiver
      await HelpRequest.findByIdAndUpdate(helpRequest._id, {
        volunteerId: formalCaregiverUser._id,
        status: 'completed',
        completedAt: new Date(),
        rating: 5,
        feedback: 'Great service provided!',
      });

      const res = await request(app)
        .get('/api/help-requests/caregiver/visits/completed')
        .set('Authorization', `Bearer ${formalCaregiverToken}`);

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].status).toBe('completed');
      expect(res.body.data[0].rating).toBe(5);
    });
  });

  // ==========================================
  // SPRINT 4: US-402 — Prevent Caregiver Schedule Conflicts
  // ==========================================
  describe('Sprint 4: US-402 — Prevent Caregiver Schedule Conflicts', () => {
    let visit1;
    let visit2SameTime;
    let visit3DifferentTime;

    beforeEach(async () => {
      // Visit 1: 2026-11-05 at 10:00 AM
      visit1 = await HelpRequest.create({
        caregiverId: familyMemberUser._id,
        elderlyId: seniorUser1._id,
        serviceType: 'Grocery',
        date: '2026-11-05',
        time: '10:00 AM',
        location: 'Galle Road, Colombo',
        status: 'searching',
      });

      // Visit 2: Same date at 10:30 AM (Conflict: within 90 minutes)
      visit2SameTime = await HelpRequest.create({
        caregiverId: familyMemberUser._id,
        elderlyId: seniorUser2._id,
        serviceType: 'Companionship',
        date: '2026-11-05',
        time: '10:30 AM',
        location: 'Bambalapitiya, Colombo',
        status: 'searching',
      });

      // Visit 3: Same date at 03:00 PM (No conflict: > 90 mins)
      visit3DifferentTime = await HelpRequest.create({
        caregiverId: familyMemberUser._id,
        elderlyId: seniorUser2._id,
        serviceType: 'Medicine',
        date: '2026-11-05',
        time: '03:00 PM',
        location: 'Dehiwala, Colombo',
        status: 'searching',
      });
    });

    it('should accept first assignment successfully with no conflicts', async () => {
      const res = await request(app)
        .post(`/api/help-requests/caregiver/assignments/${visit1._id}/accept`)
        .set('Authorization', `Bearer ${formalCaregiverToken}`)
        .send({ assignmentType: 'help_request' });

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe('confirmed');
    });

    it('should detect schedule conflict and reject second assignment within 90 minutes (US-402)', async () => {
      // Accept visit 1
      await request(app)
        .post(`/api/help-requests/caregiver/assignments/${visit1._id}/accept`)
        .set('Authorization', `Bearer ${formalCaregiverToken}`)
        .send({ assignmentType: 'help_request' });

      // Attempt to accept visit 2 (10:30 AM vs 10:00 AM)
      const conflictRes = await request(app)
        .post(`/api/help-requests/caregiver/assignments/${visit2SameTime._id}/accept`)
        .set('Authorization', `Bearer ${formalCaregiverToken}`)
        .send({ assignmentType: 'help_request' });

      expect(conflictRes.statusCode).toBe(409);
      expect(conflictRes.body.success).toBe(false);
      expect(conflictRes.body.conflict).toBe(true);
      expect(conflictRes.body.message).toContain('Schedule conflict detected');
      expect(conflictRes.body.conflictingVisit).toBeDefined();
      expect(conflictRes.body.conflictingVisit.time).toBe('10:00 AM');
    });

    it('should permit accepting a non-conflicting assignment on the same date (>90 mins apart)', async () => {
      // Accept visit 1 (10:00 AM)
      await request(app)
        .post(`/api/help-requests/caregiver/assignments/${visit1._id}/accept`)
        .set('Authorization', `Bearer ${formalCaregiverToken}`)
        .send({ assignmentType: 'help_request' });

      // Accept visit 3 (03:00 PM)
      const nonConflictRes = await request(app)
        .post(`/api/help-requests/caregiver/assignments/${visit3DifferentTime._id}/accept`)
        .set('Authorization', `Bearer ${formalCaregiverToken}`)
        .send({ assignmentType: 'help_request' });

      expect(nonConflictRes.statusCode).toBe(200);
      expect(nonConflictRes.body.success).toBe(true);
      expect(nonConflictRes.body.data.status).toBe('confirmed');
    });
  });

  // ==========================================
  // SPRINT 4: US-403 & US-411 — Caregiver-Family Messaging & Voice Messaging
  // ==========================================
  describe('Sprint 4: US-403 & US-411 — Text and Voice Messaging', () => {
    it('should allow caregiver and family member to exchange text messages (US-403)', async () => {
      // Caregiver sends text message to Family Member
      const sendRes = await request(app)
        .post('/api/messages')
        .set('Authorization', `Bearer ${formalCaregiverToken}`)
        .send({
          recipientId: familyMemberUser._id,
          content: 'Hello Amara, I have arrived for your father’s morning visit.',
          messageType: 'text',
        });

      expect(sendRes.statusCode).toBe(201);
      expect(sendRes.body.success).toBe(true);
      expect(sendRes.body.data.content).toContain('arrived for your father’s morning visit');
      expect(sendRes.body.data.messageType).toBe('text');

      // Family member fetches messages
      const getRes = await request(app)
        .get(`/api/messages/${formalCaregiverUser._id}`)
        .set('Authorization', `Bearer ${familyMemberToken}`);

      expect(getRes.statusCode).toBe(200);
      expect(getRes.body.success).toBe(true);
      expect(getRes.body.data).toHaveLength(1);
      expect(getRes.body.data[0].content).toContain('arrived for your father’s morning visit');
    });

    it('should support voice messaging for elderly users and caregivers (US-411)', async () => {
      // Senior sends a voice message to family member
      const voiceRes = await request(app)
        .post('/api/messages')
        .set('Authorization', `Bearer ${seniorToken1}`)
        .send({
          recipientId: familyMemberUser._id,
          messageType: 'voice',
          audioUrl: 'https://example.com/audio/voice-memo-123.m4a',
          durationSeconds: 14,
          content: 'Voice note (14s)',
        });

      expect(voiceRes.statusCode).toBe(201);
      expect(voiceRes.body.success).toBe(true);
      expect(voiceRes.body.data.messageType).toBe('voice');
      expect(voiceRes.body.data.audioUrl).toBe('https://example.com/audio/voice-memo-123.m4a');
      expect(voiceRes.body.data.durationSeconds).toBe(14);

      // Verify conversation inbox lists the voice message
      const convoRes = await request(app)
        .get('/api/messages/conversations')
        .set('Authorization', `Bearer ${familyMemberToken}`);

      expect(convoRes.statusCode).toBe(200);
      expect(convoRes.body.success).toBe(true);
      expect(convoRes.body.data.length).toBeGreaterThan(0);
      expect(convoRes.body.data[0].lastMessage.messageType).toBe('voice');
    });
  });

  // ==========================================
  // SPRINT 4: US-404 — Family Member View Upcoming Care Visits
  // ==========================================
  describe('Sprint 4: US-404 — Family Member View Upcoming Care Visits', () => {
    beforeEach(async () => {
      await request(app)
        .post('/api/dependents/link')
        .set('Authorization', `Bearer ${familyMemberToken}`)
        .send({ seniorId: seniorUser1._id, relationship: 'Father' });
      await request(app)
        .post('/api/dependents/respond-link')
        .set('Authorization', `Bearer ${seniorToken1}`)
        .send({ caregiverId: familyMemberUser._id, action: 'accept' });

      // Create an upcoming confirmed care visit
      await HelpRequest.create({
        caregiverId: familyMemberUser._id,
        elderlyId: seniorUser1._id,
        volunteerId: formalCaregiverUser._id,
        serviceType: 'Grocery',
        date: '2026-12-01',
        time: '09:00 AM',
        location: 'Kandy Road, Colombo',
        status: 'confirmed',
      });
    });

    it('should return upcoming care visits across all linked seniors for family member', async () => {
      const res = await request(app)
        .get('/api/dependents/upcoming-visits')
        .set('Authorization', `Bearer ${familyMemberToken}`);

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toBeDefined();
      expect(res.body.data.length).toBeGreaterThan(0);

      const visit = res.body.data[0];
      expect(visit.serviceType).toBe('Grocery');
      expect(visit.date).toBe('2026-12-01');
      expect(visit.time).toBe('09:00 AM');
      expect(visit.assignedVolunteer).toBeDefined();
      expect(visit.assignedVolunteer.firstName).toBe('Rohan');
    });
  });
});
