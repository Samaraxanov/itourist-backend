import { z } from 'zod';
import type { Request, Response } from 'express';
import { Router } from 'express';
import { prisma } from '../../lib/prisma.js';
import { ApiError } from '../../utils/apiError.js';
import { bookingReference } from '../../utils/slugify.js';
import { catchAsync } from '../../utils/catchAsync.js';
import { validate } from '../../middleware/validate.js';
import { authenticate } from '../../middleware/authenticate.js';
import { authorize } from '../../middleware/authorize.js';

// ---------- Schemas ----------
const createBookingSchema = z.object({
  tourId: z.string().min(1),
  startDate: z.coerce.date().refine((d) => d > new Date(), 'Start date must be in the future'),
  peopleCount: z.number().int().positive().max(50).default(1),
  contactName: z.string().min(2).max(120),
  contactPhone: z.string().min(5).max(30),
  contactEmail: z.string().email(),
  note: z.string().max(1000).optional(),
});

const respondSchema = z.object({
  action: z.enum(['confirm', 'decline']),
  message: z.string().max(1000).optional(),
});

// ---------- Service ----------
async function createBooking(userId: string, input: z.infer<typeof createBookingSchema>) {
  const tour = await prisma.tour.findFirst({
    where: { id: input.tourId, status: 'PUBLISHED', deletedAt: null },
  });
  if (!tour) throw ApiError.notFound('Tour not available for booking');
  if (tour.maxGroupSize && input.peopleCount > tour.maxGroupSize) {
    throw ApiError.badRequest(`This tour allows at most ${tour.maxGroupSize} people`);
  }

  // Price snapshot: capture the price at request time so later edits don't change it.
  const totalPrice = tour.priceFrom * input.peopleCount;

  return prisma.booking.create({
    data: {
      reference: bookingReference(),
      tourId: tour.id,
      userId,
      startDate: input.startDate,
      peopleCount: input.peopleCount,
      totalPrice,
      currency: tour.currency,
      contactName: input.contactName,
      contactPhone: input.contactPhone,
      contactEmail: input.contactEmail,
      note: input.note,
      status: 'REQUESTED',
    },
  });
}

// Bookings the logged-in user has made.
const listMyBookings = (userId: string) =>
  prisma.booking.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    include: { tour: { select: { id: true, slug: true, title: true, images: true } } },
  });

// Bookings placed against the firm's tours (the firm's inbox).
async function listFirmBookings(userId: string) {
  const firm = await prisma.firm.findUnique({ where: { ownerId: userId } });
  if (!firm) throw ApiError.forbidden('You do not have a firm profile');
  return prisma.booking.findMany({
    where: { tour: { firmId: firm.id } },
    orderBy: { createdAt: 'desc' },
    include: {
      tour: { select: { id: true, slug: true, title: true } },
      user: { select: { firstName: true, lastName: true, email: true } },
    },
  });
}

async function respondToBooking(
  userId: string,
  bookingId: string,
  input: z.infer<typeof respondSchema>
) {
  const firm = await prisma.firm.findUnique({ where: { ownerId: userId } });
  if (!firm) throw ApiError.forbidden('You do not have a firm profile');

  const booking = await prisma.booking.findFirst({
    where: { id: bookingId, tour: { firmId: firm.id } },
  });
  if (!booking) throw ApiError.notFound('Booking not found');
  if (booking.status !== 'REQUESTED') {
    throw ApiError.conflict(`Booking is already ${booking.status.toLowerCase()}`);
  }

  return prisma.booking.update({
    where: { id: bookingId },
    data: {
      status: input.action === 'confirm' ? 'CONFIRMED' : 'DECLINED',
      firmResponse: input.message,
      respondedAt: new Date(),
    },
  });
  // TODO(phase 8): enqueue email/SMS notification to the traveller here.
}

// ---------- Routes ----------
const router = Router();

router.post(
  '/',
  authenticate,
  validate({ body: createBookingSchema }),
  catchAsync(async (req: Request, res: Response) => {
    res.status(201).json(await createBooking(req.auth!.userId, req.body));
  })
);

router.get(
  '/mine',
  authenticate,
  catchAsync(async (req: Request, res: Response) => {
    res.json(await listMyBookings(req.auth!.userId));
  })
);

router.get(
  '/firm',
  authenticate,
  authorize('FIRM'),
  catchAsync(async (req: Request, res: Response) => {
    res.json(await listFirmBookings(req.auth!.userId));
  })
);

router.post(
  '/:id/respond',
  authenticate,
  authorize('FIRM'),
  validate({ body: respondSchema }),
  catchAsync(async (req: Request, res: Response) => {
    res.json(await respondToBooking(req.auth!.userId, req.params.id, req.body));
  })
);

export default router;
