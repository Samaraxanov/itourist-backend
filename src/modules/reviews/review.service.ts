import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { ApiError } from '../../utils/apiError.js';
import { notify } from '../notifications/notification.service.js';
import { pick } from '../../utils/multilingual.js';
import type { CreateReviewInput, ListReviewsQuery } from './review.schema.js';

// Recompute a tour's denormalised rating aggregates inside a transaction.
// Called on every review write so `ratingAvg` / `ratingCount` stay accurate for
// cheap sorting and display.
async function recomputeTourRating(tx: Prisma.TransactionClient, tourId: string) {
  const agg = await tx.review.aggregate({
    where: { tourId },
    _avg: { rating: true },
    _count: { rating: true },
  });
  await tx.tour.update({
    where: { id: tourId },
    data: {
      ratingAvg: agg._avg.rating ? Number(agg._avg.rating.toFixed(2)) : 0,
      ratingCount: agg._count.rating,
    },
  });
}

// A review may only be written by the traveller who completed the booking, once.
export async function createReview(userId: string, input: CreateReviewInput) {
  const booking = await prisma.booking.findFirst({
    where: { id: input.bookingId, userId },
    include: { tour: { select: { id: true, title: true, firm: { select: { ownerId: true } } } }, review: true },
  });
  if (!booking) throw ApiError.notFound('Booking not found');
  if (booking.status !== 'COMPLETED') {
    throw ApiError.badRequest('You can only review a tour after the booking is completed');
  }
  if (booking.review) throw ApiError.conflict('You have already reviewed this booking');

  const review = await prisma.$transaction(async (tx) => {
    const created = await tx.review.create({
      data: {
        tourId: booking.tourId,
        userId,
        bookingId: booking.id,
        rating: input.rating,
        comment: input.comment,
      },
    });
    await recomputeTourRating(tx, booking.tourId);
    return created;
  });

  // Tell the firm owner a review landed (best-effort, outside the transaction).
  await notify({
    userId: booking.tour.firm.ownerId,
    type: 'REVIEW_RECEIVED',
    title: 'New review',
    body: `${pick(booking.tour.title as never)} received a ${input.rating}★ review.`,
    data: { tourId: booking.tourId, reviewId: review.id },
  });

  return review;
}

export async function listTourReviews(query: ListReviewsQuery) {
  const skip = (query.page - 1) * query.pageSize;
  const where = { tourId: query.tourId };
  const [items, total] = await prisma.$transaction([
    prisma.review.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take: query.pageSize,
      select: {
        id: true, rating: true, comment: true, firmReply: true, createdAt: true,
        user: { select: { firstName: true, lastName: true } },
      },
    }),
    prisma.review.count({ where }),
  ]);
  return {
    items,
    pagination: {
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages: Math.ceil(total / query.pageSize),
    },
  };
}

// A firm can publicly reply to a review left on one of its own tours.
export async function replyToReview(userId: string, reviewId: string, reply: string) {
  const firm = await prisma.firm.findUnique({ where: { ownerId: userId } });
  if (!firm) throw ApiError.forbidden('You do not have a firm profile');

  const review = await prisma.review.findFirst({
    where: { id: reviewId, tour: { firmId: firm.id } },
  });
  if (!review) throw ApiError.notFound('Review not found');

  return prisma.review.update({ where: { id: reviewId }, data: { firmReply: reply } });
}
