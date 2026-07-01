import { Prisma, type PaymentProvider } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { ApiError } from '../../utils/apiError.js';
import { env } from '../../config/env.js';
import { logger } from '../../lib/logger.js';
import { notify } from '../notifications/notification.service.js';
import { pick } from '../../utils/multilingual.js';

// Payments — MOCK provider set (Payme / Click / Uzum / MOCK).
//
// This models the real Uzbekistan hold-then-capture flow without touching any
// external API:
//   1. Booking confirmed  → payment PENDING (invoice created)
//   2. Traveller "pays"    → AUTHORIZED (funds held)
//   3. Tour completed      → CAPTURED  (funds taken, commission split recorded)
//   4. Cancel/decline      → CANCELLED (hold released) or REFUNDED (after capture)
//
// A single webhook endpoint simulates a provider callback. Swapping in real
// Payme/Click/Uzum SDKs is contained to this file + the webhook route.

const COMMISSION_PCT = env.PLATFORM_COMMISSION_PCT;

// Deterministic-enough mock reference. Avoids Math.random (kept reproducible).
function mockRef(provider: PaymentProvider, seed: string) {
  return `${provider.toLowerCase()}_${seed.slice(0, 10)}`;
}

function splitCommission(amount: number) {
  const commissionAmount = Math.round((amount * COMMISSION_PCT) / 100);
  return { commissionAmount, netAmount: amount - commissionAmount };
}

async function logEvent(
  tx: Prisma.TransactionClient,
  paymentId: string,
  type: string,
  payload?: Prisma.InputJsonValue
) {
  await tx.paymentEvent.create({ data: { paymentId, type, payload } });
}

// Create the invoice for a CONFIRMED booking the caller owns.
export async function createForBooking(userId: string, bookingId: string, provider: PaymentProvider) {
  const booking = await prisma.booking.findFirst({
    where: { id: bookingId, userId },
    include: { payment: true },
  });
  if (!booking) throw ApiError.notFound('Booking not found');
  if (booking.status !== 'CONFIRMED') {
    throw ApiError.badRequest('Payment can only start once the firm confirms your booking');
  }
  if (booking.payment && booking.payment.status !== 'FAILED' && booking.payment.status !== 'CANCELLED') {
    return booking.payment; // idempotent: reuse an in-flight invoice
  }

  const payment = await prisma.payment.upsert({
    where: { bookingId },
    update: { provider, status: 'PENDING', providerRef: mockRef(provider, bookingId) },
    create: {
      bookingId,
      provider,
      status: 'PENDING',
      amount: booking.totalPrice,
      currency: booking.currency,
      providerRef: mockRef(provider, bookingId),
    },
  });
  await prisma.paymentEvent.create({ data: { paymentId: payment.id, type: 'invoice.created' } });

  // A real integration returns the provider's hosted checkout URL here.
  return { ...payment, checkoutUrl: `${env.PUBLIC_BASE_URL}/api/v1/payments/${payment.id}/mock-checkout` };
}

// Simulate the traveller completing provider checkout → funds held (AUTHORIZED).
export async function authorize(userId: string, paymentId: string) {
  const payment = await prisma.payment.findFirst({
    where: { id: paymentId, booking: { userId } },
    include: { booking: true },
  });
  if (!payment) throw ApiError.notFound('Payment not found');
  if (payment.status === 'AUTHORIZED' || payment.status === 'CAPTURED') return payment;
  if (payment.status !== 'PENDING') throw ApiError.conflict(`Payment is ${payment.status.toLowerCase()}`);

  const updated = await prisma.$transaction(async (tx) => {
    const p = await tx.payment.update({
      where: { id: paymentId },
      data: { status: 'AUTHORIZED', authorizedAt: new Date() },
    });
    await logEvent(tx, paymentId, 'authorized');
    return p;
  });
  logger.info({ paymentId, provider: payment.provider }, '[MOCK PAYMENT] funds authorized (held)');
  return updated;
}

// Capture funds and record the commission split. Called when a booking completes.
// Safe to call with no payment or a non-authorized payment (no-op).
export async function captureForBooking(bookingId: string) {
  const payment = await prisma.payment.findUnique({ where: { bookingId } });
  if (!payment || payment.status !== 'AUTHORIZED') return null;

  const { commissionAmount, netAmount } = splitCommission(payment.amount);
  const captured = await prisma.$transaction(async (tx) => {
    const p = await tx.payment.update({
      where: { id: payment.id },
      data: { status: 'CAPTURED', capturedAt: new Date(), commissionAmount, netAmount },
    });
    await logEvent(tx, payment.id, 'captured', { commissionAmount, netAmount });
    return p;
  });
  logger.info(
    { bookingId, amount: payment.amount, commissionAmount, netAmount },
    '[MOCK PAYMENT] captured with commission split'
  );
  return captured;
}

// Release a held (uncaptured) payment when a booking is cancelled/declined.
export async function releaseForBooking(bookingId: string) {
  const payment = await prisma.payment.findUnique({ where: { bookingId } });
  if (!payment) return null;
  if (payment.status === 'CAPTURED') return refund(payment.id);
  if (payment.status !== 'AUTHORIZED' && payment.status !== 'PENDING') return payment;

  return prisma.$transaction(async (tx) => {
    const p = await tx.payment.update({ where: { id: payment.id }, data: { status: 'CANCELLED' } });
    await logEvent(tx, payment.id, 'cancelled');
    return p;
  });
}

// Refund a captured payment (e.g. late cancellation, dispute).
export async function refund(paymentId: string) {
  const payment = await prisma.payment.findUnique({
    where: { id: paymentId },
    include: { booking: { select: { userId: true, reference: true } } },
  });
  if (!payment) throw ApiError.notFound('Payment not found');
  if (payment.status !== 'CAPTURED') throw ApiError.conflict('Only captured payments can be refunded');

  const refunded = await prisma.$transaction(async (tx) => {
    const p = await tx.payment.update({
      where: { id: paymentId },
      data: { status: 'REFUNDED', refundedAt: new Date() },
    });
    await logEvent(tx, paymentId, 'refunded');
    return p;
  });

  await notify({
    userId: payment.booking.userId,
    type: 'PAYMENT_REFUNDED',
    title: 'Refund issued',
    body: `Your payment for booking ${payment.booking.reference} has been refunded.`,
    data: { bookingId: payment.bookingId },
  });
  return refunded;
}

export async function getForBooking(userId: string, bookingId: string) {
  const payment = await prisma.payment.findFirst({
    where: { bookingId, booking: { userId } },
    include: { events: { orderBy: { createdAt: 'asc' } } },
  });
  if (!payment) throw ApiError.notFound('Payment not found');
  return payment;
}

// Simulated provider webhook. A real provider signs these; here we look the
// payment up by its providerRef and apply the requested transition.
export async function handleWebhook(body: { providerRef?: string; event?: string }) {
  if (!body.providerRef || !body.event) throw ApiError.badRequest('providerRef and event are required');
  const payment = await prisma.payment.findFirst({ where: { providerRef: body.providerRef } });
  if (!payment) throw ApiError.notFound('Unknown providerRef');

  await prisma.paymentEvent.create({
    data: { paymentId: payment.id, type: `webhook:${body.event}`, payload: body as Prisma.InputJsonValue },
  });

  switch (body.event) {
    case 'authorized':
      if (payment.status === 'PENDING') {
        await prisma.payment.update({
          where: { id: payment.id },
          data: { status: 'AUTHORIZED', authorizedAt: new Date() },
        });
      }
      break;
    case 'captured':
      await captureForBooking(payment.bookingId);
      break;
    case 'failed':
      if (payment.status === 'PENDING') {
        await prisma.payment.update({ where: { id: payment.id }, data: { status: 'FAILED' } });
      }
      break;
    default:
      throw ApiError.badRequest(`Unsupported event: ${body.event}`);
  }
  return { ok: true };
}

// Notify both sides that a payment settled. Called by the booking service on capture.
export async function notifyCaptured(bookingId: string) {
  const payment = await prisma.payment.findUnique({
    where: { bookingId },
    include: {
      booking: {
        select: {
          userId: true, reference: true,
          tour: { select: { title: true, firm: { select: { ownerId: true } } } },
        },
      },
    },
  });
  if (!payment || payment.status !== 'CAPTURED') return;
  const { booking } = payment;
  await Promise.all([
    notify({
      userId: booking.userId,
      type: 'PAYMENT_CAPTURED',
      title: 'Payment complete',
      body: `Your payment for ${pick(booking.tour.title as never)} is complete. Enjoy your trip!`,
      data: { bookingId },
    }),
    notify({
      userId: booking.tour.firm.ownerId,
      type: 'PAYMENT_CAPTURED',
      title: 'Payout recorded',
      body: `Booking ${booking.reference} settled — payout ${payment.netAmount} (minus commission ${payment.commissionAmount}).`,
      data: { bookingId },
    }),
  ]);
}
