import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { ApiError } from '../../utils/apiError.js';
import { slugify } from '../../utils/slugify.js';
import { buildSearchText, type Multilingual } from '../../utils/multilingual.js';
import type { CreateTourInput, UpdateTourInput, ListToursQuery } from './tour.schema.js';

// ---------- Public catalog ----------

// Structural (non-text) filters shared by the Prisma and full-text paths.
function buildPublicWhere(query: ListToursQuery): Prisma.TourWhereInput {
  const where: Prisma.TourWhereInput = { status: 'PUBLISHED', deletedAt: null };

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
  return where;
}

// Promoted tours sort first, then the chosen key. The lazy sweep below keeps the
// `featured` flag honest so this simple ordering stays correct.
function buildOrderBy(sort: ListToursQuery['sort']): Prisma.TourOrderByWithRelationInput[] {
  const primary: Prisma.TourOrderByWithRelationInput = { featured: 'desc' };
  switch (sort) {
    case 'price_asc':
      return [primary, { priceFrom: 'asc' }];
    case 'price_desc':
      return [primary, { priceFrom: 'desc' }];
    case 'rating':
      return [primary, { ratingAvg: 'desc' }];
    case 'newest':
    default:
      return [primary, { publishedAt: 'desc' }];
  }
}

// SQL ORDER BY fragment for the full-text path. Promotion first, then relevance
// (default) or the chosen sort key.
function ftsOrderBy(sort: ListToursQuery['sort'], tsquery: Prisma.Sql): Prisma.Sql {
  const promoted = Prisma.sql`"featured" DESC`;
  switch (sort) {
    case 'price_asc':
      return Prisma.sql`${promoted}, "priceFrom" ASC`;
    case 'price_desc':
      return Prisma.sql`${promoted}, "priceFrom" DESC`;
    case 'rating':
      return Prisma.sql`${promoted}, "ratingAvg" DESC`;
    case 'newest':
    default:
      // No explicit sort chosen alongside a query → order by text relevance.
      return Prisma.sql`${promoted}, ts_rank("searchVector", ${tsquery}) DESC, "publishedAt" DESC`;
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
  featured: true,
  region: { select: { id: true, slug: true, name: true } },
  category: { select: { id: true, slug: true, name: true } },
  firm: { select: { id: true, name: true, slug: true, logoUrl: true } },
} satisfies Prisma.TourSelect;

// Demote featured tours whose promotion window has elapsed. Cheap (usually 0 rows)
// and keeps `featured`-based ordering correct without a background job.
async function unpromoteExpired() {
  await prisma.tour.updateMany({
    where: { featured: true, featuredUntil: { not: null, lt: new Date() } },
    data: { featured: false },
  });
}

export async function listPublicTours(query: ListToursQuery) {
  await unpromoteExpired();

  // Full-text path: use the tsvector + GIN index for real, scalable, typo-lenient
  // search over the maintained `searchText`. We resolve a ranked, paginated id set
  // in SQL, then hydrate through Prisma preserving that order.
  if (query.q) {
    return searchPublicTours(query);
  }

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

  return { items, pagination: paginate(query, total) };
}

async function searchPublicTours(query: ListToursQuery) {
  const skip = (query.page - 1) * query.pageSize;
  const tsquery = Prisma.sql`websearch_to_tsquery('simple', ${query.q})`;

  // Compose the WHERE from the base full-text match + the same structural filters.
  const conds: Prisma.Sql[] = [
    Prisma.sql`status = 'PUBLISHED'`,
    Prisma.sql`"deletedAt" IS NULL`,
    Prisma.sql`"searchVector" @@ ${tsquery}`,
  ];
  if (query.regionId) conds.push(Prisma.sql`"regionId" = ${query.regionId}`);
  if (query.categoryId) conds.push(Prisma.sql`"categoryId" = ${query.categoryId}`);
  if (query.firmId) conds.push(Prisma.sql`"firmId" = ${query.firmId}`);
  if (query.language) conds.push(Prisma.sql`${query.language} = ANY("languages")`);
  if (query.minPrice != null) conds.push(Prisma.sql`"priceFrom" >= ${query.minPrice}`);
  if (query.maxPrice != null) conds.push(Prisma.sql`"priceFrom" <= ${query.maxPrice}`);
  if (query.minDuration != null) conds.push(Prisma.sql`"durationDays" >= ${query.minDuration}`);
  if (query.maxDuration != null) conds.push(Prisma.sql`"durationDays" <= ${query.maxDuration}`);
  const whereSql = Prisma.join(conds, ' AND ');

  const [idRows, countRows] = await prisma.$transaction([
    prisma.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM "Tour"
      WHERE ${whereSql}
      ORDER BY ${ftsOrderBy(query.sort, tsquery)}
      LIMIT ${query.pageSize} OFFSET ${skip}
    `,
    prisma.$queryRaw<Array<{ count: number }>>`
      SELECT count(*)::int AS count FROM "Tour" WHERE ${whereSql}
    `,
  ]);

  const ids = idRows.map((r) => r.id);
  const total = countRows[0]?.count ?? 0;

  // Hydrate with the standard card projection, then restore the ranked order.
  const rows = await prisma.tour.findMany({ where: { id: { in: ids } }, select: cardSelect });
  const byId = new Map(rows.map((t) => [t.id, t]));
  const items = ids.map((id) => byId.get(id)).filter((t): t is (typeof rows)[number] => Boolean(t));

  return { items, pagination: paginate(query, total) };
}

function paginate(query: ListToursQuery, total: number) {
  return {
    page: query.page,
    pageSize: query.pageSize,
    total,
    totalPages: Math.ceil(total / query.pageSize),
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
      // Upcoming, bookable departures with remaining seats.
      departures: {
        where: { status: 'OPEN', startDate: { gte: new Date() } },
        orderBy: { startDate: 'asc' },
        select: {
          id: true, startDate: true, endDate: true, capacity: true,
          seatsBooked: true, priceOverride: true, instantConfirm: true,
        },
      },
      reviews: {
        take: 10,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true, rating: true, comment: true, firmReply: true, createdAt: true,
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
    select: {
      ...cardSelect,
      status: true,
      featuredUntil: true,
      createdAt: true,
      updatedAt: true,
      _count: { select: { bookings: true, departures: true } },
    },
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
      searchText: buildSearchText(input.title, input.summary, input.description),
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
  const { tour } = await ownTourOrThrow(userId, tourId);

  // Recompute searchText from the merged (incoming ⊕ existing) text fields so the
  // full-text index tracks edits.
  const merged = {
    title: (input.title ?? tour.title) as Multilingual,
    summary: (input.summary ?? tour.summary) as Multilingual,
    description: (input.description ?? tour.description) as Multilingual,
  };

  return prisma.tour.update({
    where: { id: tourId },
    data: {
      ...input,
      itinerary: input.itinerary as Prisma.InputJsonValue | undefined,
      included: input.included as Prisma.InputJsonValue | undefined,
      excluded: input.excluded as Prisma.InputJsonValue | undefined,
      searchText: buildSearchText(merged.title, merged.summary, merged.description),
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
