// tests/IT23831254/auth_lifecycle.test.js
const request = require('supertest');
const app = require('../../server');
require('../setup');

describe('IT23831254: Auth & User Lifecycle Integration Tests', () => {
  const testElderlyPayload = {
    firstName: 'Nimal',
    lastName: 'Perera',
    email: 'nimal.perera@example.com',
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
    emergencyContact: {
      name: 'Sunil Perera',
      phone: '0779876543',
      relationship: 'Son',
    },
  };

  it('should register a new elderly user with an atomic sequential ID (ELD-0001)', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send(testElderlyPayload);

    expect(res.statusCode).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body).toHaveProperty('token');
    expect(res.body.user).toHaveProperty('customId', 'ELD-0001');
    expect(res.body.user.role).toBe('elderly');
    expect(res.body.user).not.toHaveProperty('password');
  });

  it('should prevent duplicate registration with the same email', async () => {
    await request(app).post('/api/auth/register').send(testElderlyPayload);
    const res = await request(app).post('/api/auth/register').send(testElderlyPayload);

    expect(res.statusCode).toBe(409);
    expect(res.body.success).toBe(false);
  });

  it('should authenticate user and return profile on /api/auth/me', async () => {
    const registerRes = await request(app).post('/api/auth/register').send(testElderlyPayload);
    const token = registerRes.body.token;

    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({
        email: testElderlyPayload.email,
        password: testElderlyPayload.password,
      });

    expect(loginRes.statusCode).toBe(200);
    expect(loginRes.body.success).toBe(true);
    expect(loginRes.body).toHaveProperty('token');

    const meRes = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${token}`);

    expect(meRes.statusCode).toBe(200);
    expect(meRes.body.user.email).toBe(testElderlyPayload.email.toLowerCase());
  });

  it('should reject unauthenticated requests to protected endpoints', async () => {
    const res = await request(app).get('/api/auth/me');
    expect(res.statusCode).toBe(401);
  });
});
