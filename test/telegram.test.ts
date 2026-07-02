import crypto from 'node:crypto';
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { prisma } from '../src/lib/prisma.js';
import { resetDb } from './helpers.js';

const app = createApp();
const api = (p: string) => `/api/v1${p}`;
const BOT = 'test-bot-token'; // matches vitest.config env

// Build a validly-signed Telegram initData string (mirrors the server's verify).
function buildInitData(user: object) {
  const params = new URLSearchParams();
  params.set('auth_date', String(Math.floor(Date.now() / 1000)));
  params.set('user', JSON.stringify(user));
  const dcs = [...params.entries()].map(([k, v]) => `${k}=${v}`).sort().join('\n');
  const secret = crypto.createHmac('sha256', 'WebAppData').update(BOT).digest();
  params.set('hash', crypto.createHmac('sha256', secret).update(dcs).digest('hex'));
  return params.toString();
}

describe('telegram mini app auth', () => {
  beforeEach(resetDb);
  afterAll(() => prisma.$disconnect());

  it('creates a USER account from valid initData and is idempotent', async () => {
    const initData = buildInitData({ id: 123, first_name: 'Aziz', username: 'aziz' });

    const first = await request(app).post(api('/auth/telegram')).send({ initData });
    expect(first.status).toBe(200);
    expect(first.body.user.role).toBe('USER');
    expect(first.body.accessToken).toBeTruthy();

    // Second login with the same Telegram id reuses the account.
    const second = await request(app).post(api('/auth/telegram')).send({ initData: buildInitData({ id: 123, first_name: 'Aziz' }) });
    expect(second.status).toBe(200);
    expect(await prisma.user.count()).toBe(1);
  });

  it('rejects tampered initData', async () => {
    const bad = buildInitData({ id: 5 }).replace(/hash=[a-f0-9]+/, 'hash=deadbeef');
    const res = await request(app).post(api('/auth/telegram')).send({ initData: bad });
    expect(res.status).toBe(401);
  });

  it('promotes configured admin ids to ADMIN', async () => {
    const res = await request(app).post(api('/auth/telegram')).send({ initData: buildInitData({ id: 999, first_name: 'Boss' }) });
    expect(res.status).toBe(200);
    expect(res.body.user.role).toBe('ADMIN');
  });

  it('lets a telegram user become a firm', async () => {
    const login = await request(app).post(api('/auth/telegram')).send({ initData: buildInitData({ id: 321, first_name: 'Op' }) });
    const token = login.body.accessToken as string;

    const reg = await request(app).post(api('/firms/register')).set('Authorization', `Bearer ${token}`).send({ firmName: 'TG Tours' });
    expect(reg.status).toBe(201);
    expect(reg.body.status).toBe('PENDING');

    // Re-auth mints a token carrying the upgraded FIRM role → firm endpoints work.
    const reauth = await request(app).post(api('/auth/telegram')).send({ initData: buildInitData({ id: 321 }) });
    const mine = await request(app).get(api('/tours/mine')).set('Authorization', `Bearer ${reauth.body.accessToken}`);
    expect(mine.status).toBe(200);
  });
});
