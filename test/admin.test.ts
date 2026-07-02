import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { prisma } from '../src/lib/prisma.js';
import { resetDb, makeUser } from './helpers.js';

const app = createApp();
const api = (p: string) => `/api/v1${p}`;

async function adminToken() {
  await makeUser('admin@test.uz', 'ADMIN');
  const res = await request(app).post(api('/auth/login')).send({ email: 'admin@test.uz', password: 'Password123!' });
  return res.body.accessToken as string;
}

describe('admin creates firms', () => {
  beforeEach(resetDb);
  afterAll(() => prisma.$disconnect());

  it('creates a firm + owner and returns a temp password the owner can log in with', async () => {
    const token = await adminToken();
    const res = await request(app)
      .post(api('/admin/firms'))
      .set('Authorization', `Bearer ${token}`)
      .send({ email: 'new@firm.uz', firmName: 'New Firm', status: 'VERIFIED' });

    expect(res.status).toBe(201);
    expect(res.body.firm.status).toBe('VERIFIED');
    expect(res.body.firm.slug).toBeTruthy();
    expect(typeof res.body.tempPassword).toBe('string');

    // The generated credentials work.
    const login = await request(app).post(api('/auth/login')).send({ email: 'new@firm.uz', password: res.body.tempPassword });
    expect(login.status).toBe(200);
    expect(login.body.user.role).toBe('FIRM');
  });

  it('honours an explicit password and omits tempPassword', async () => {
    const token = await adminToken();
    const res = await request(app)
      .post(api('/admin/firms'))
      .set('Authorization', `Bearer ${token}`)
      .send({ email: 'set@firm.uz', firmName: 'Set Firm', password: 'ChosenPass1!', status: 'PENDING' });
    expect(res.status).toBe(201);
    expect(res.body.tempPassword).toBeUndefined();
    const login = await request(app).post(api('/auth/login')).send({ email: 'set@firm.uz', password: 'ChosenPass1!' });
    expect(login.status).toBe(200);
  });

  it('rejects a duplicate email and blocks non-admins', async () => {
    const token = await adminToken();
    await makeUser('taken@firm.uz', 'USER');
    const dupe = await request(app).post(api('/admin/firms')).set('Authorization', `Bearer ${token}`)
      .send({ email: 'taken@firm.uz', firmName: 'Dupe' });
    expect(dupe.status).toBe(409);

    const userReg = await request(app).post(api('/auth/register')).send({ email: 'plain@u.uz', password: 'Password123!' });
    const forbidden = await request(app).post(api('/admin/firms')).set('Authorization', `Bearer ${userReg.body.accessToken}`)
      .send({ email: 'x@firm.uz', firmName: 'X' });
    expect(forbidden.status).toBe(403);
  });
});
