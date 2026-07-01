import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { ApiError } from '../../utils/apiError.js';
import { bookingReference } from '../../utils/slugify.js';
import { pick } from '../../utils/multilingual.js';
import { notify } from '../notifications/notification.service.js';
import * as payments from '../payments/payment.service.js';
import type { CreateBookingInput, RespondInput } from './booking.schema.js';

const tourCard = { id: true, slug: true, title: true, images: true } as const;

// ---------- Create ----------

export async function createBooking(userId: string, input: CreateBookingInput) {
  const tour = await prisma.tour.findFirst({
    where: { id: input.tourId, status: 'PUBLISHED', deletedAt: null },
    include: { firm: { select: { ownerId: true } } },
  });
  if (!tour) throw ApiError.notFound('Tour not available for booking');

  // Resolve pricing, date, and seat handling from the departure (if any).
  let departureId: string | undefined;
  let startDate: Date;
  let unitPrice = tour.priceFrom;
  let instantConfirm = false;

  if (input.departureId) {
    const departure = await prisma.departure.findFirst({
      where: { id: input.departureId, tourId: tour.id },
    });
    if (!departure) throw ApiError.notFound('Departure not found for this tour');
    if (departure.status !== 'OPEN') throw ApiError.conflict('This departure is not open for booking');
    if (departure.startDate <= new Date()) throw ApiError.badRequest('This departure has already left');
    if (departure.seatsBooked + input.peopleCount > departure.capacity) {
      const left = departure.capacity - departure.seatsBooked;
      throw ApiError.conflict(`Only ${left} seat(s) left on this departure`);
    }
    departureId = departure.id;
    startDate = departure.startDate;
    unitPrice = departure.priceOverride ?? tour.priceFrom;
    instantConfirm = departure.instantConfirm;
  } else {
    startDate = input.startDate!;
    if (startDate <= new Date()) throw ApiError.badRequest('Start date must be in the future');
    if (tour.maxGroupSize && input.peopleCount > tour.maxGroupSize) {
      throw ApiError.badRequest(`This tour allows at most ${tour.maxGroupSize} people`);
    }
  }

  const totalPrice = unitPrice * input.peopleCount;
  const status = instantConfirm ? 'CONFIRMED' : 'REQUESTED';

  // Reserve the seat and create the booking atomically so two racing requests
  // can't oversell a departure.
  const booking = await prisma.$transaction(async (tx) => {
    if (departureId) {
      await tx.departure.update({
        where: { id: departureId },
        data: { seatsBooked: { increment: input.peopleCount } },
      });
    }
    return tx.booking.create({
      data: {
        reference: bookingReference(),
        tourId: tour.id,
        userId,
        departureId,
        startDate,
        peopleCount: input.peopleCount,
        totalPrice,
        currency: tour.currency,
        contactName: input.contactName,
        contactPhone: input.contactPhone,
        contactEmail: input.contactEmail,
        note: input.note,
        status,
        respondedAt: instantConfirm ? new Date() : null,
      },
    });
  });

  // Notify the right party depending on whether it auto-confirmed.
  if (instantConfirm) {
    await notify({
      userId,
      type: 'BOOKING_CONFIRMED',
      title: 'Booking confirmed',
      body: `Your booking for ${pick(tour.title as never)} is confirmed. Please complete payment.`,
      data: { bookingId: booking.id },
    });
  } else {
    await notify({
      userId: tour.firm.ownerId,
      type: 'BOOKING_REQUESTED',
      title: 'New booking request',
      body: `${input.contactName} requested ${pick(tour.title as never)} for ${input.peopleCount} people.`,
      data: { bookingId: booking.id },
    });
  }

  return booking;
}

// ---------- Reads ----------

export function listMyBookings(userId: string) {
  return prisma.booking.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    include: {
      tour: { select: tourCard },
      departure: { select: { id: true, startDate: true } },
      payment: { select: { id: true, status: true, amount: true, currency: true, provider: true } },
      review: { select: { id: true, rating: true } },
    },
  });
}

async function requireFirm(userId: string) {
  const firm = await prisma.firm.findUnique({ where: { ownerId: userId } });
  if (!firm) throw ApiError.forbidden('You do not have a firm profile');
  return firm;
}

export async function listFirmBookings(userId: string) {
  const firm = await requireFirm(userId);
  return prisma.booking.findMany({
    where: { tour: { firmId: firm.id } },
    orderBy: { createdAt: 'desc' },
    include: {
      tour: { select: { id: true, slug: true, title: true } },
      departure: { select: { id: true, startDate: true } },
      payment: { select: { id: true, status: true, netAmount: true, currency: true } },
      user: { select: { firstName: true, lastName: true, email: true } },
    },
  });
}

// ---------- Firm transitions ----------

// Load a booking that belongs to the caller's firm, with the fields transitions need.
async function firmBookingOrThrow(userId: string, bookingId: string) {
  const firm = await requireFirm(userId);
  const booking = await prisma.booking.findFirst({
    where: { id: bookingId, tour: { firmId: firm.id } },
    include: { tour: { select: { title: true } } },
  });
  if (!booking) throw ApiError.notFound('Booking not found');
  return booking;
}

export async function respondToBooking(userId: string, bookingId: string, input: RespondInput) {
  const booking = await firmBookingOrThrow(userId, bookingId);
  if (booking.status !== 'REQUESTED') {
    throw ApiError.conflict(`Booking is already ${booking.status.toLowerCase()}`);
  }

  if (input.action === 'decline') {
    const updated = await prisma.$transaction(async (tx) => {
      await releaseSeats(tx, booking.departureId, booking.peopleCount);
      return tx.booking.update({
        where: { id: bookingId },
        data: { status: 'DECLINED', firmResponse: input.message, respondedAt: new Date() },
      });
    });
    await notify({
      userId: booking.userId,
      type: 'BOOKING_DECLINED',
      title: 'Booking declined',
      body: `Your request for ${pick(booking.tour.title as never)} was declined.${input.message ? ` "${input.message}"` : ''}`,
      data: { bookingId },
    });
    return updated;
  }

  const updated = await prisma.booking.update({
    where: { id: bookingId },
    data: { status: 'CONFIRMED', firmResponse: input.message, respondedAt: new Date() },
  });
  await notify({
    userId: booking.userId,
    type: 'BOOKING_CONFIRMED',
    title: 'Booking confirmed',
    body: `Your booking for ${pick(booking.tour.title as never)} is confirmed. Please complete payment.`,
    data: { bookingId },
  });
  return updated;
}

// Firm marks a confirmed booking as completed → capture payment, invite a review.
export async function completeBooking(userId: string, bookingId: string) {
  const booking = await firmBookingOrThrow(userId, bookingId);
  if (booking.status !== 'CONFIRMED') {
    throw ApiError.conflict('Only confirmed bookings can be completed');
  }
  const updated = await prisma.booking.update({
    where: { id: bookingId },
    data: { status: 'COMPLETED', completedAt: new Date() },
  });

  // Capture funds (no-op if no authorized payment), then notify both sides.
  await payments.captureForBooking(bookingId);
  await payments.notifyCaptured(bookingId);
  await notify({
    userId: booking.userId,
    type: 'BOOKING_COMPLETED',
    title: 'How was your trip?',
    body: `Your ${pick(booking.tour.title as never)} tour is complete. Leave a review to help other travellers.`,
    data: { bookingId },
  });
  return updated;
}

// ---------- Traveller transitions ----------

export async function cancelBooking(userId: string, bookingId: string) {
  const booking = await prisma.booking.findFirst({
    where: { id: bookingId, userId },
    include: { tour: { select: { title: true, firm: { select: { ownerId: true } } } } },
  });
  if (!booking) throw ApiError.notFound('Booking not found');
  if (booking.status === 'COMPLETED') throw ApiError.conflict('A completed booking cannot be cancelled');
  if (booking.status === 'CANCELLED' || booking.status === 'DECLINED') {
    throw ApiError.conflict(`Booking is already ${booking.status.toLowerCase()}`);
  }

  const updated = await prisma.$transaction(async (tx) => {
    await releaseSeats(tx, booking.departureId, booking.peopleCount);
    return tx.booking.update({
      where: { id: bookingId },
      data: { status: 'CANCELLED', cancelledAt: new Date() },
    });
  });

  // Release a held payment, or refund if it was already captured.
  await payments.releaseForBooking(bookingId);
  await notify({
    userId: booking.tour.firm.ownerId,
    type: 'BOOKING_CANCELLED',
    title: 'Booking cancelled',
    body: `${booking.contactName} cancelled their booking for ${pick(booking.tour.title as never)}.`,
    data: { bookingId },
  });
  return updated;
}

// Give seats back to a departure without going negative.
async function releaseSeats(tx: Prisma.TransactionClient, departureId: string | null, seats: number) {
  if (!departureId) return;
  const dep = await tx.departure.findUnique({ where: { id: departureId }, select: { seatsBooked: true } });
  if (!dep) return;
  await tx.departure.update({
    where: { id: departureId },
    data: { seatsBooked: Math.max(0, dep.seatsBooked - seats) },
  });
}
