import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { prisma } from '../src/lib/prisma.js';
import { resetDb } from './helpers.js';

const app = createApp();

describe('auth', () => {
  beforeEach(resetDb);
  afterAll(() => prisma.$disconnect());

  it('registers, logs in, and returns a token pair', async () => {
    const reg = await request(app)
      .post('/api/v1/auth/register')
      .send({ email: 'a@test.uz', password: 'Password123!', firstName: 'A' });
    expect(reg.status).toBe(201);
    expect(reg.body.accessToken).toBeTruthy();
    expect(reg.body.refreshToken).toBeTruthy();
    expect(reg.body.user.role).toBe('USER');

    const login = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'a@test.uz', password: 'Password123!' });
    expect(login.status).toBe(200);
    expect(login.body.accessToken).toBeTruthy();
  });

  it('registers a firm account with a PENDING firm shell', async () => {
    const reg = await request(app)
      .post('/api/v1/auth/register')
      .send({ email: 'firm@test.uz', password: 'Password123!', asFirm: true, firmName: 'My Firm' });
    expect(reg.status).toBe(201);
    expect(reg.body.user.role).toBe('FIRM');

    const me = await request(app).get('/api/v1/auth/me').set('Authorization', `Bearer ${reg.body.accessToken}`);
    expect(me.body.firm.status).toBe('PENDING');
  });

  it('rotates refresh tokens and detects reuse', async () => {
    const reg = await request(app)
      .post('/api/v1/auth/register')
      .send({ email: 'b@test.uz', password: 'Password123!' });
    const first = reg.body.refreshToken as string;

    // Rotate: the old token is revoked and a new one issued.
    const r1 = await request(app).post('/api/v1/auth/refresh').send({ refreshToken: first });
    expect(r1.status).toBe(200);
    const second = r1.body.refreshToken as string;
    expect(second).not.toBe(first);

    // Reusing the now-revoked first token is rejected (theft signal).
    const reuse = await request(app).post('/api/v1/auth/refresh').send({ refreshToken: first });
    expect(reuse.status).toBe(401);

    // Reuse detection revokes the whole family, so the second token is dead too.
    const afterReuse = await request(app).post('/api/v1/auth/refresh').send({ refreshToken: second });
    expect(afterReuse.status).toBe(401);
  });

  it('rejects bad credentials with 401', async () => {
    await request(app).post('/api/v1/auth/register').send({ email: 'c@test.uz', password: 'Password123!' });
    const res = await request(app).post('/api/v1/auth/login').send({ email: 'c@test.uz', password: 'wrong' });
    expect(res.status).toBe(401);
  });
});
