import crypto from 'node:crypto';
import { Prisma, type FirmStatus } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { ApiError } from '../../utils/apiError.js';
import { hashPassword } from '../../utils/password.js';
import { slugify } from '../../utils/slugify.js';
import { notify } from '../notifications/notification.service.js';

// ---------- Admin-created firms ----------

interface CreateFirmInput {
  email: string;
  firmName: string;
  password?: string; // optional; a temporary one is generated when omitted
  phone?: string;
  licenseNo?: string;
  status: 'PENDING' | 'VERIFIED';
}

// Generate a firm slug unique across firms.
async function uniqueFirmSlug(tx: Prisma.TransactionClient, name: string) {
  const base = slugify(name);
  let slug = base;
  let n = 1;
  while (await tx.firm.findUnique({ where: { slug } })) slug = `${base}-${n++}`;
  return slug;
}

// Admin onboards a firm directly: creates the owner account + firm together.
// Returns the temporary password only when one was generated, so the admin can
// share initial credentials with the operator.
export async function createFirm(input: CreateFirmInput) {
  const existing = await prisma.user.findUnique({ where: { email: input.email } });
  if (existing) throw ApiError.conflict('A user with this email already exists');

  const tempPassword = input.password ?? crypto.randomBytes(9).toString('base64url').slice(0, 12);
  const passwordHash = await hashPassword(tempPassword);

  const firm = await prisma.$transaction(async (tx) => {
    const owner = await tx.user.create({
      data: { email: input.email, passwordHash, role: 'FIRM' },
    });
    return tx.firm.create({
      data: {
        ownerId: owner.id,
        name: input.firmName,
        slug: await uniqueFirmSlug(tx, input.firmName),
        email: input.email,
        phone: input.phone,
        licenseNo: input.licenseNo,
        status: input.status,
        verifiedAt: input.status === 'VERIFIED' ? new Date() : null,
      },
    });
  });

  return { firm, tempPassword: input.password ? undefined : tempPassword };
}

// ---------- Firm verification queue ----------

export function listFirms(status?: FirmStatus) {
  return prisma.firm.findMany({
    where: status ? { status } : undefined,
    orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
    include: {
      owner: { select: { email: true, firstName: true, lastName: true } },
      _count: { select: { tours: true } },
    },
  });
}

export async function verifyFirm(firmId: string, status: FirmStatus) {
  const firm = await prisma.firm.findUnique({ where: { id: firmId } });
  if (!firm) throw ApiError.notFound('Firm not found');

  const updated = await prisma.firm.update({
    where: { id: firmId },
    data: {
      status,
      // Stamp verifiedAt when approving; preserve the existing stamp otherwise so
      // suspending a firm doesn't erase its verification history.
      verifiedAt: status === 'VERIFIED' ? new Date() : firm.verifiedAt,
    },
  });

  await notify({
    userId: firm.ownerId,
    type: status === 'VERIFIED' ? 'FIRM_VERIFIED' : 'FIRM_STATUS_CHANGED',
    title: status === 'VERIFIED' ? 'Your firm is verified' : 'Firm status changed',
    body:
      status === 'VERIFIED'
        ? 'You can now publish live tours.'
        : `Your firm status is now ${status.toLowerCase()}.`,
    data: { firmId },
  });
  return updated;
}

// ---------- Moderation ----------

export function listTours() {
  return prisma.tour.findMany({
    where: { deletedAt: null },
    orderBy: { createdAt: 'desc' },
    take: 200,
    select: {
      id: true, slug: true, title: true, status: true, featured: true, featuredUntil: true,
      priceFrom: true, currency: true, ratingAvg: true, ratingCount: true, createdAt: true,
      firm: { select: { id: true, name: true, slug: true, status: true } },
    },
  });
}

// Promote a tour (featured listing) for N days, or clear promotion when days<=0.
export async function setFeatured(tourId: string, days: number) {
  const tour = await prisma.tour.findUnique({ where: { id: tourId } });
  if (!tour) throw ApiError.notFound('Tour not found');
  const featured = days > 0;
  const featuredUntil = featured ? new Date(Date.now() + days * 24 * 60 * 60 * 1000) : null;
  return prisma.tour.update({ where: { id: tourId }, data: { featured, featuredUntil } });
}

// Admin take-down: force a tour out of the public catalog.
export async function unpublishTour(tourId: string) {
  const tour = await prisma.tour.findUnique({ where: { id: tourId } });
  if (!tour) throw ApiError.notFound('Tour not found');
  return prisma.tour.update({ where: { id: tourId }, data: { status: 'UNPUBLISHED' } });
}

// ---------- Platform stats ----------

export async function platformStats() {
  const [
    users,
    firmsByStatus,
    tours,
    publishedTours,
    bookingsByStatus,
    captured,
  ] = await Promise.all([
    prisma.user.count(),
    prisma.firm.groupBy({ by: ['status'], _count: true }),
    prisma.tour.count({ where: { deletedAt: null } }),
    prisma.tour.count({ where: { status: 'PUBLISHED', deletedAt: null } }),
    prisma.booking.groupBy({ by: ['status'], _count: true }),
    prisma.payment.aggregate({
      where: { status: 'CAPTURED' },
      _sum: { amount: true, commissionAmount: true, netAmount: true },
      _count: true,
    }),
  ]);

  return {
    users,
    firms: Object.fromEntries(firmsByStatus.map((f) => [f.status, f._count])),
    tours: { total: tours, published: publishedTours },
    bookings: Object.fromEntries(bookingsByStatus.map((b) => [b.status, b._count])),
    revenue: {
      capturedCount: captured._count,
      gross: captured._sum.amount ?? 0,
      commission: captured._sum.commissionAmount ?? 0,
      payouts: captured._sum.netAmount ?? 0,
    },
  };
}

export function listPayments() {
  return prisma.payment.findMany({
    orderBy: { createdAt: 'desc' },
    take: 100,
    include: {
      booking: {
        select: {
          reference: true,
          tour: { select: { title: true, firm: { select: { name: true } } } },
        },
      },
    },
  });
}
