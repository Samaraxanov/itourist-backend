import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { prisma } from '../src/lib/prisma.js';
import { resetDb, makeVerifiedFirm } from './helpers.js';

const app = createApp();
const api = (p: string) => `/api/v1${p}`;

// Register a traveller and return an auth header + user id.
async function traveller(email = 'trav@test.uz') {
  const res = await request(app).post(api('/auth/register')).send({ email, password: 'Password123!', firstName: 'T' });
  return { bearer: `Bearer ${res.body.accessToken}`, userId: res.body.user.id };
}

describe('catalog & search', () => {
  beforeEach(resetDb);
  afterAll(() => prisma.$disconnect());

  it('finds a published tour via full-text search, ignores drafts', async () => {
    const { firm } = await makeVerifiedFirm();
    await prisma.tour.create({
      data: {
        firmId: firm.id, slug: 'registan-tour', title: { en: 'Registan Evening Tour' },
        priceFrom: 100, currency: 'USD', status: 'PUBLISHED', publishedAt: new Date(),
        searchText: 'Registan Evening Tour Samarkand',
      },
    });
    await prisma.tour.create({
      data: {
        firmId: firm.id, slug: 'draft-tour', title: { en: 'Registan Secret Draft' },
        priceFrom: 100, currency: 'USD', status: 'DRAFT', searchText: 'Registan Secret Draft',
      },
    });

    const hit = await request(app).get(api('/tours?q=registan'));
    expect(hit.status).toBe(200);
    expect(hit.body.items).toHaveLength(1);
    expect(hit.body.items[0].slug).toBe('registan-tour');

    const miss = await request(app).get(api('/tours?q=nonexistentword'));
    expect(miss.body.items).toHaveLength(0);
  });
});

describe('publish gating', () => {
  beforeEach(resetDb);

  it('blocks an unverified firm from publishing', async () => {
    const reg = await request(app)
      .post(api('/auth/register'))
      .send({ email: 'pending@test.uz', password: 'Password123!', asFirm: true, firmName: 'Pending Co' });
    const bearer = `Bearer ${reg.body.accessToken}`;

    const created = await request(app).post(api('/tours')).set('Authorization', bearer).send({ title: { en: 'X' }, priceFrom: 10 });
    expect(created.status).toBe(201);

    const publish = await request(app).post(api(`/tours/${created.body.id}/publish`)).set('Authorization', bearer).send({ publish: true });
    expect(publish.status).toBe(403);
  });
});

describe('full booking → payment → completion → review lifecycle', () => {
  beforeEach(resetDb);
  afterAll(() => prisma.$disconnect());

  it('runs an instant-confirm departure through to a captured payment and review', async () => {
    const { firm, owner } = await makeVerifiedFirm();
    const firmLogin = await request(app).post(api('/auth/login')).send({ email: owner.email, password: 'Password123!' });
    const firmBearer = `Bearer ${firmLogin.body.accessToken}`;

    const tour = await prisma.tour.create({
      data: {
        firmId: firm.id, slug: 'lifecycle-tour', title: { en: 'Lifecycle Tour' },
        priceFrom: 1000, currency: 'USD', status: 'PUBLISHED', publishedAt: new Date(),
        searchText: 'Lifecycle Tour',
      },
    });
    const departure = await prisma.departure.create({
      data: { tourId: tour.id, startDate: new Date(Date.now() + 7 * 864e5), capacity: 2, instantConfirm: true },
    });

    const trav = await traveller();

    // Book the instant-confirm departure → CONFIRMED, one seat taken.
    const booking = await request(app).post(api('/bookings')).set('Authorization', trav.bearer).send({
      tourId: tour.id, departureId: departure.id, peopleCount: 2,
      contactName: 'Trav Eller', contactPhone: '+998900000000', contactEmail: 'trav@test.uz',
    });
    expect(booking.status).toBe(201);
    expect(booking.body.status).toBe('CONFIRMED');
    const bookingId = booking.body.id;

    const dep = await prisma.departure.findUnique({ where: { id: departure.id } });
    expect(dep!.seatsBooked).toBe(2);

    // A third seat would oversell (capacity 2) → 409.
    const trav2 = await traveller('trav2@test.uz');
    const oversell = await request(app).post(api('/bookings')).set('Authorization', trav2.bearer).send({
      tourId: tour.id, departureId: departure.id, peopleCount: 1,
      contactName: 'Two', contactPhone: '+998900000001', contactEmail: 'trav2@test.uz',
    });
    expect(oversell.status).toBe(409);

    // Pay: create invoice then complete mock checkout → AUTHORIZED.
    const pay = await request(app).post(api('/payments')).set('Authorization', trav.bearer).send({ bookingId, provider: 'MOCK' });
    expect(pay.status).toBe(201);
    const checkout = await request(app).post(api(`/payments/${pay.body.id}/mock-checkout`)).set('Authorization', trav.bearer).send();
    expect(checkout.body.status).toBe('AUTHORIZED');

    // Firm completes the booking → payment CAPTURED with 10% commission split.
    const complete = await request(app).post(api(`/bookings/${bookingId}/complete`)).set('Authorization', firmBearer).send();
    expect(complete.body.status).toBe('COMPLETED');

    const payment = await prisma.payment.findUnique({ where: { bookingId } });
    expect(payment!.status).toBe('CAPTURED');
    expect(payment!.commissionAmount).toBe(200); // 10% of 2000
    expect(payment!.netAmount).toBe(1800);

    // Traveller reviews the completed booking → rating aggregates recompute.
    const review = await request(app).post(api('/reviews')).set('Authorization', trav.bearer).send({ bookingId, rating: 4, comment: 'Great' });
    expect(review.status).toBe(201);

    const updatedTour = await prisma.tour.findUnique({ where: { id: tour.id } });
    expect(updatedTour!.ratingCount).toBe(1);
    expect(updatedTour!.ratingAvg).toBe(4);

    // Cannot review twice.
    const dupe = await request(app).post(api('/reviews')).set('Authorization', trav.bearer).send({ bookingId, rating: 5 });
    expect(dupe.status).toBe(409);
  });

  it('rejects a review when the booking is not completed', async () => {
    const { firm } = await makeVerifiedFirm('firm2@test.uz');
    const tour = await prisma.tour.create({
      data: { firmId: firm.id, slug: 'nc-tour', title: { en: 'NC' }, priceFrom: 10, currency: 'USD', status: 'PUBLISHED', publishedAt: new Date() },
    });
    const trav = await traveller('nc@test.uz');
    const booking = await request(app).post(api('/bookings')).set('Authorization', trav.bearer).send({
      tourId: tour.id, startDate: new Date(Date.now() + 5 * 864e5).toISOString(), peopleCount: 1,
      contactName: 'NC', contactPhone: '+998900000002', contactEmail: 'nc@test.uz',
    });
    const res = await request(app).post(api('/reviews')).set('Authorization', trav.bearer).send({ bookingId: booking.body.id, rating: 5 });
    expect(res.status).toBe(400);
  });
});
