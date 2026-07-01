import { prisma } from '../../lib/prisma.js';
import { ApiError } from '../../utils/apiError.js';
import type { CreateDepartureInput, UpdateDepartureInput } from './departure.schema.js';

// Confirm the caller's firm owns the tour behind a departure operation.
async function requireOwnedTour(userId: string, tourId: string) {
  const firm = await prisma.firm.findUnique({ where: { ownerId: userId } });
  if (!firm) throw ApiError.forbidden('You do not have a firm profile');
  const tour = await prisma.tour.findFirst({ where: { id: tourId, firmId: firm.id, deletedAt: null } });
  if (!tour) throw ApiError.notFound('Tour not found in your firm');
  return { firm, tour };
}

async function ownDepartureOrThrow(userId: string, departureId: string) {
  const firm = await prisma.firm.findUnique({ where: { ownerId: userId } });
  if (!firm) throw ApiError.forbidden('You do not have a firm profile');
  const departure = await prisma.departure.findFirst({
    where: { id: departureId, tour: { firmId: firm.id } },
  });
  if (!departure) throw ApiError.notFound('Departure not found in your firm');
  return departure;
}

// Public: upcoming, open departures with seats remaining, for the tour detail page.
export function listPublic(tourId: string) {
  return prisma.departure.findMany({
    where: { tourId, status: 'OPEN', startDate: { gte: new Date() } },
    orderBy: { startDate: 'asc' },
    select: {
      id: true, startDate: true, endDate: true, capacity: true,
      seatsBooked: true, priceOverride: true, instantConfirm: true,
    },
  });
}

// Firm: every departure for a tour it owns (any status), with booking counts.
export async function listForFirm(userId: string, tourId: string) {
  await requireOwnedTour(userId, tourId);
  return prisma.departure.findMany({
    where: { tourId },
    orderBy: { startDate: 'asc' },
    include: { _count: { select: { bookings: true } } },
  });
}

export async function create(userId: string, input: CreateDepartureInput) {
  await requireOwnedTour(userId, input.tourId);
  return prisma.departure.create({
    data: {
      tourId: input.tourId,
      startDate: input.startDate,
      endDate: input.endDate,
      capacity: input.capacity,
      priceOverride: input.priceOverride,
      instantConfirm: input.instantConfirm,
    },
  });
}

export async function update(userId: string, departureId: string, input: UpdateDepartureInput) {
  const departure = await ownDepartureOrThrow(userId, departureId);
  if (input.capacity != null && input.capacity < departure.seatsBooked) {
    throw ApiError.badRequest(`Capacity cannot be below the ${departure.seatsBooked} seats already booked`);
  }
  return prisma.departure.update({ where: { id: departureId }, data: input });
}

// Cancel (soft): keep the row so existing bookings still reference it.
export async function cancel(userId: string, departureId: string) {
  await ownDepartureOrThrow(userId, departureId);
  return prisma.departure.update({ where: { id: departureId }, data: { status: 'CANCELLED' } });
}
