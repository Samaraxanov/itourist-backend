import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { ApiError } from '../../utils/apiError.js';
import { slugify } from '../../utils/slugify.js';
import type { CreateTourInput, UpdateTourInput, ListToursQuery } from './tour.schema.js';

// ---------- Public catalog ----------

// Builds the WHERE clause for public browsing. Only PUBLISHED, non-deleted tours.
function buildPublicWhere(query: ListToursQuery): Prisma.TourWhereInput {
  const where: Prisma.TourWhereInput = {
    status: 'PUBLISHED',
    deletedAt: null,
  };

  if (query.regionId) where.regionId = query.regionId;
  if (query.categoryId) where.categoryId = query.categoryId;
  if (query.firmId) where.firmId = query.firmId;
  if (query.language) where.languages = { has: query.language };

  if (query.minPrice != null || query.maxPrice != null) {
    where.priceFrom = {
      ...(query.minPrice != null ? { gte: query.minPrice } : {}),
      ...(query.maxPrice != null ? { lte: query.maxPrice } : {}),
    };
  }
  if (query.minDuration != null || query.maxDuration != null) {
    where.durationDays = {
      ...(query.minDuration != null ? { gte: query.minDuration } : {}),
      ...(query.maxDuration != null ? { lte: query.maxDuration } : {}),
    };
  }

  // Free-text search across multilingual JSON title/summary.
  // Prisma's JSON `string_contains` is case-sensitive on Postgres; for production
  // move to a generated tsvector column or Meilisearch (see ARCHITECTURE.md).
  if (query.q) {
    const q = query.q;
    where.OR = [
      { title: { path: ['uz'], string_contains: q } },
      { title: { path: ['ru'], string_contains: q } },
      { title: { path: ['en'], string_contains: q } },
      { summary: { path: ['uz'], string_contains: q } },
      { summary: { path: ['ru'], string_contains: q } },
      { summary: { path: ['en'], string_contains: q } },
    ];
  }

  return where;
}

function buildOrderBy(sort: ListToursQuery['sort']): Prisma.TourOrderByWithRelationInput {
  switch (sort) {
    case 'price_asc':
      return { priceFrom: 'asc' };
    case 'price_desc':
      return { priceFrom: 'desc' };
    case 'rating':
      return { ratingAvg: 'desc' };
    case 'newest':
    default:
      return { publishedAt: 'desc' };
  }
}

const cardSelect = {
  id: true,
  slug: true,
  title: true,
  summary: true,
  priceFrom: true,
  currency: true,
  durationDays: true,
  durationHours: true,
  images: true,
  ratingAvg: true,
  ratingCount: true,
  languages: true,
  region: { select: { id: true, slug: true, name: true } },
  category: { select: { id: true, slug: true, name: true } },
  firm: { select: { id: true, name: true, slug: true, logoUrl: true } },
} satisfies Prisma.TourSelect;

export async function listPublicTours(query: ListToursQuery) {
  const where = buildPublicWhere(query);
  const skip = (query.page - 1) * query.pageSize;

  const [items, total] = await prisma.$transaction([
    prisma.tour.findMany({
      where,
      orderBy: buildOrderBy(query.sort),
      skip,
      take: query.pageSize,
      select: cardSelect,
    }),
    prisma.tour.count({ where }),
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

export async function getPublicTour(idOrSlug: string) {
  const tour = await prisma.tour.findFirst({
    where: {
      OR: [{ id: idOrSlug }, { slug: idOrSlug }],
      status: 'PUBLISHED',
      deletedAt: null,
    },
    include: {
      region: { select: { id: true, slug: true, name: true } },
      category: { select: { id: true, slug: true, name: true } },
      firm: {
        select: { id: true, name: true, slug: true, logoUrl: true, description: true, phone: true, website: true },
      },
      reviews: {
        take: 10,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          rating: true,
          comment: true,
          createdAt: true,
          user: { select: { firstName: true, lastName: true } },
        },
      },
    },
  });
  if (!tour) throw ApiError.notFound('Tour not found');
  return tour;
}

// ---------- Firm-scoped management ----------

// Resolve the caller's firm, ensuring they own one.
async function requireFirm(userId: string) {
  const firm = await prisma.firm.findUnique({ where: { ownerId: userId } });
  if (!firm) throw ApiError.forbidden('You do not have a firm profile');
  return firm;
}

export async function listFirmTours(userId: string) {
  const firm = await requireFirm(userId);
  return prisma.tour.findMany({
    where: { firmId: firm.id, deletedAt: null },
    orderBy: { updatedAt: 'desc' },
    select: { ...cardSelect, status: true, createdAt: true, updatedAt: true },
  });
}

export async function createTour(userId: string, input: CreateTourInput) {
  const firm = await requireFirm(userId);

  const baseTitle = input.title.en || input.title.ru || input.title.uz || 'tour';
  const slug = await uniqueTourSlug(baseTitle);

  return prisma.tour.create({
    data: {
      firmId: firm.id,
      slug,
      title: input.title,
      summary: input.summary,
      description: input.description,
      itinerary: input.itinerary as Prisma.InputJsonValue | undefined,
      priceFrom: input.priceFrom,
      currency: input.currency,
      durationDays: input.durationDays,
      durationHours: input.durationHours,
      maxGroupSize: input.maxGroupSize,
      minAge: input.minAge,
      languages: input.languages,
      categoryId: input.categoryId,
      regionId: input.regionId,
      images: input.images,
      included: input.included as Prisma.InputJsonValue | undefined,
      excluded: input.excluded as Prisma.InputJsonValue | undefined,
      status: 'DRAFT',
    },
  });
}

// Ensure the tour belongs to the caller's firm before any mutation.
async function ownTourOrThrow(userId: string, tourId: string) {
  const firm = await requireFirm(userId);
  const tour = await prisma.tour.findFirst({
    where: { id: tourId, firmId: firm.id, deletedAt: null },
  });
  if (!tour) throw ApiError.notFound('Tour not found in your firm');
  return { firm, tour };
}

export async function updateTour(userId: string, tourId: string, input: UpdateTourInput) {
  await ownTourOrThrow(userId, tourId);
  return prisma.tour.update({
    where: { id: tourId },
    data: {
      ...input,
      itinerary: input.itinerary as Prisma.InputJsonValue | undefined,
      included: input.included as Prisma.InputJsonValue | undefined,
      excluded: input.excluded as Prisma.InputJsonValue | undefined,
    },
  });
}

// Publish gating: a firm must be VERIFIED to make a tour publicly visible.
export async function setPublishState(userId: string, tourId: string, publish: boolean) {
  const { firm } = await ownTourOrThrow(userId, tourId);

  if (publish && firm.status !== 'VERIFIED') {
    throw ApiError.forbidden('Your firm must be verified before publishing tours');
  }

  return prisma.tour.update({
    where: { id: tourId },
    data: {
      status: publish ? 'PUBLISHED' : 'UNPUBLISHED',
      publishedAt: publish ? new Date() : undefined,
    },
  });
}

export async function deleteTour(userId: string, tourId: string) {
  await ownTourOrThrow(userId, tourId);
  // Soft delete to preserve historical bookings/reviews.
  await prisma.tour.update({
    where: { id: tourId },
    data: { deletedAt: new Date(), status: 'ARCHIVED' },
  });
}

async function uniqueTourSlug(title: string) {
  const base = slugify(title);
  let slug = base;
  let n = 1;
  while (await prisma.tour.findUnique({ where: { slug } })) {
    slug = `${base}-${n++}`;
  }
  return slug;
}
