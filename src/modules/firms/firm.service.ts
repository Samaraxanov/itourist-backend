import type { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { ApiError } from '../../utils/apiError.js';

export interface UpdateFirmInput {
  name?: string;
  description?: { uz?: string; ru?: string; en?: string };
  logoUrl?: string;
  coverUrl?: string;
  phone?: string;
  website?: string;
  address?: string;
  licenseNo?: string;
}

// Public firm profile + its live catalog.
export async function getPublicFirm(slug: string) {
  const firm = await prisma.firm.findUnique({
    where: { slug },
    select: {
      id: true, name: true, slug: true, description: true, logoUrl: true,
      coverUrl: true, website: true, phone: true, address: true, status: true,
      verifiedAt: true, createdAt: true,
      tours: {
        where: { status: 'PUBLISHED', deletedAt: null },
        orderBy: [{ featured: 'desc' }, { publishedAt: 'desc' }],
        select: {
          id: true, slug: true, title: true, summary: true, priceFrom: true,
          currency: true, images: true, ratingAvg: true, ratingCount: true,
          durationDays: true, durationHours: true, featured: true,
        },
      },
    },
  });
  if (!firm || firm.status === 'REJECTED') throw ApiError.notFound('Firm not found');
  return firm;
}

async function requireFirm(userId: string) {
  const firm = await prisma.firm.findUnique({ where: { ownerId: userId } });
  if (!firm) throw ApiError.notFound('Firm profile not found');
  return firm;
}

export async function updateProfile(userId: string, input: UpdateFirmInput) {
  const firm = await requireFirm(userId);
  return prisma.firm.update({
    where: { id: firm.id },
    data: { ...input, description: input.description as Prisma.InputJsonValue | undefined },
  });
}

// Firm analytics dashboard (Phase 7): the numbers a firm owner wants at a glance.
export async function analytics(userId: string) {
  const firm = await requireFirm(userId);

  const [tourAgg, bookingsByStatus, revenue, upcomingDepartures, recentBookings, ratingAgg] =
    await Promise.all([
      prisma.tour.aggregate({
        where: { firmId: firm.id, deletedAt: null },
        _count: true,
      }),
      prisma.booking.groupBy({
        by: ['status'],
        where: { tour: { firmId: firm.id } },
        _count: true,
      }),
      prisma.payment.aggregate({
        where: { status: 'CAPTURED', booking: { tour: { firmId: firm.id } } },
        _sum: { netAmount: true, amount: true, commissionAmount: true },
        _count: true,
      }),
      prisma.departure.count({
        where: { tour: { firmId: firm.id }, status: 'OPEN', startDate: { gte: new Date() } },
      }),
      prisma.booking.findMany({
        where: { tour: { firmId: firm.id } },
        orderBy: { createdAt: 'desc' },
        take: 5,
        select: {
          id: true, reference: true, status: true, totalPrice: true, currency: true,
          createdAt: true, tour: { select: { title: true } },
        },
      }),
      prisma.tour.aggregate({
        where: { firmId: firm.id, deletedAt: null, ratingCount: { gt: 0 } },
        _avg: { ratingAvg: true },
        _sum: { ratingCount: true },
      }),
    ]);

  const publishedCount = await prisma.tour.count({
    where: { firmId: firm.id, deletedAt: null, status: 'PUBLISHED' },
  });

  return {
    firm: { id: firm.id, name: firm.name, slug: firm.slug, status: firm.status },
    tours: { total: tourAgg._count, published: publishedCount },
    bookings: Object.fromEntries(bookingsByStatus.map((b) => [b.status, b._count])),
    upcomingDepartures,
    revenue: {
      settledBookings: revenue._count,
      gross: revenue._sum.amount ?? 0,
      commission: revenue._sum.commissionAmount ?? 0,
      payouts: revenue._sum.netAmount ?? 0,
    },
    rating: {
      avg: ratingAgg._avg.ratingAvg ? Number(ratingAgg._avg.ratingAvg.toFixed(2)) : 0,
      count: ratingAgg._sum.ratingCount ?? 0,
    },
    recentBookings,
  };
}
