import { PrismaClient } from '@prisma/client';
import argon2 from 'argon2';

const prisma = new PrismaClient();

const ml = (uz: string, ru: string, en: string) => ({ uz, ru, en });

// Concatenate multilingual fields into the maintained full-text `searchText`.
// (Mirrors backend/src/utils/multilingual.ts so the seed populates the same column.)
const searchText = (...fields: Array<{ uz?: string; ru?: string; en?: string } | undefined>) =>
  fields
    .filter(Boolean)
    .flatMap((f) => [f!.uz, f!.ru, f!.en])
    .filter(Boolean)
    .join(' ')
    .slice(0, 4000);

const daysFromNow = (n: number) => new Date(Date.now() + n * 24 * 60 * 60 * 1000);

async function main() {
  const passwordHash = await argon2.hash('Password123!', { type: argon2.argon2id });

  // --- Admin ---
  await prisma.user.upsert({
    where: { email: 'admin@tourmarket.uz' },
    update: {},
    create: { email: 'admin@tourmarket.uz', passwordHash, role: 'ADMIN', firstName: 'Platform', lastName: 'Admin' },
  });

  // --- Traveller (for booking/review demos) ---
  const traveller = await prisma.user.upsert({
    where: { email: 'traveller@example.uz' },
    update: {},
    create: {
      email: 'traveller@example.uz', passwordHash, role: 'USER',
      firstName: 'Aziz', lastName: 'Karimov', phone: '+998 90 000 11 22',
    },
  });

  // --- Regions ---
  const regions = await Promise.all(
    [
      ['samarkand', ml('Samarqand', 'Самарканд', 'Samarkand')],
      ['bukhara', ml('Buxoro', 'Бухара', 'Bukhara')],
      ['khiva', ml('Xiva', 'Хива', 'Khiva')],
      ['tashkent', ml('Toshkent', 'Ташкент', 'Tashkent')],
      ['fergana', ml('Fargʻona', 'Фергана', 'Fergana')],
    ].map(([slug, name]) =>
      prisma.region.upsert({
        where: { slug: slug as string },
        update: {},
        create: { slug: slug as string, name: name as object },
      })
    )
  );

  // --- Categories ---
  const categories = await Promise.all(
    [
      ['cultural', ml('Madaniy', 'Культурный', 'Cultural'), '🏛️'],
      ['adventure', ml('Sarguzasht', 'Приключения', 'Adventure'), '⛰️'],
      ['gastro', ml('Gastronomik', 'Гастрономический', 'Gastronomy'), '🍽️'],
      ['city', ml('Shahar', 'Городской', 'City tour'), '🚌'],
    ].map(([slug, name, icon]) =>
      prisma.category.upsert({
        where: { slug: slug as string },
        update: {},
        create: { slug: slug as string, name: name as object, icon: icon as string },
      })
    )
  );

  const regionBy = (slug: string) => regions.find((r) => r.slug === slug)!;
  const categoryBy = (slug: string) => categories.find((c) => c.slug === slug)!;

  // --- Sample verified firm ---
  const firmOwner = await prisma.user.upsert({
    where: { email: 'firm@silkroad.uz' },
    update: {},
    create: { email: 'firm@silkroad.uz', passwordHash, role: 'FIRM', firstName: 'Silk', lastName: 'Road' },
  });

  const firm = await prisma.firm.upsert({
    where: { ownerId: firmOwner.id },
    update: { status: 'VERIFIED' },
    create: {
      ownerId: firmOwner.id,
      name: 'Silk Road Travel',
      slug: 'silk-road-travel',
      status: 'VERIFIED',
      verifiedAt: new Date(),
      email: 'firm@silkroad.uz',
      phone: '+998 90 123 45 67',
      website: 'https://silkroad.example.uz',
      licenseNo: 'UZ-TOUR-2021-0456',
      description: ml(
        'Oʻzbekiston boʻylab tajribali gidlar bilan sayohatlar.',
        'Путешествия по Узбекистану с опытными гидами.',
        'Tours across Uzbekistan with experienced local guides.'
      ),
    },
  });

  // --- Second firm, PENDING — populates the admin verification queue ---
  const firm2Owner = await prisma.user.upsert({
    where: { email: 'firm@oasis.uz' },
    update: {},
    create: { email: 'firm@oasis.uz', passwordHash, role: 'FIRM', firstName: 'Oasis', lastName: 'Tours' },
  });
  await prisma.firm.upsert({
    where: { ownerId: firm2Owner.id },
    update: {},
    create: {
      ownerId: firm2Owner.id,
      name: 'Oasis Desert Tours',
      slug: 'oasis-desert-tours',
      status: 'PENDING',
      email: 'firm@oasis.uz',
      phone: '+998 91 555 66 77',
      licenseNo: 'UZ-TOUR-2024-0912',
      description: ml('Choʻl sarguzashtlari.', 'Пустынные приключения.', 'Desert adventures and yurt stays.'),
    },
  });

  // --- Sample tours ---
  const t1Title = ml('Samarqand sayohati', 'Жемчужины Самарканда', 'Samarkand Highlights');
  const t1Summary = ml(
    'Registon, Bibi-Xonim va Shohi Zinda 2 kunda.',
    'Регистан, Биби-Ханым и Шахи-Зинда за 2 дня.',
    'Registan, Bibi-Khanym and Shah-i-Zinda in two days.'
  );
  const t1Desc = ml(
    'Samarqandning eng mashhur yodgorliklari boʻylab toʻliq sayohat.',
    'Полное путешествие по знаменитым памятникам Самарканда.',
    'A complete journey through Samarkand’s most famous monuments with a licensed guide.'
  );
  const tour1 = await prisma.tour.upsert({
    where: { slug: 'samarkand-highlights-2-days' },
    update: { searchText: searchText(t1Title, t1Summary, t1Desc), featured: true, featuredUntil: daysFromNow(30) },
    create: {
      firmId: firm.id,
      slug: 'samarkand-highlights-2-days',
      title: t1Title,
      summary: t1Summary,
      description: t1Desc,
      priceFrom: 1_500_000, // 1,500,000 UZS
      currency: 'UZS',
      durationDays: 2,
      maxGroupSize: 12,
      languages: ['uz', 'ru', 'en'],
      regionId: regionBy('samarkand').id,
      categoryId: categoryBy('cultural').id,
      images: ['https://images.unsplash.com/photo-1602940659805-770d1b3b9911?w=1200'],
      status: 'PUBLISHED',
      publishedAt: new Date(),
      searchText: searchText(t1Title, t1Summary, t1Desc),
      featured: true,
      featuredUntil: daysFromNow(30),
    },
  });

  const t2Title = ml('Buxoro eski shahri', 'Старый город Бухары', 'Bukhara Old City Walk');
  const t2Summary = ml('Yarim kunlik piyoda sayohat.', 'Полудневная пешеходная экскурсия.', 'Half-day guided walking tour.');
  const tour2 = await prisma.tour.upsert({
    where: { slug: 'bukhara-old-city-walk' },
    update: { searchText: searchText(t2Title, t2Summary) },
    create: {
      firmId: firm.id,
      slug: 'bukhara-old-city-walk',
      title: t2Title,
      summary: t2Summary,
      priceFrom: 450_000,
      currency: 'UZS',
      durationDays: 1,
      durationHours: 4,
      languages: ['ru', 'en'],
      regionId: regionBy('bukhara').id,
      categoryId: categoryBy('city').id,
      images: ['https://images.unsplash.com/photo-1631793984637-6c47b3f9dc2f?w=1200'],
      status: 'PUBLISHED',
      publishedAt: new Date(),
      searchText: searchText(t2Title, t2Summary),
    },
  });

  // --- Departures (availability) ---
  // Idempotency: only create departures if this tour has none yet.
  if ((await prisma.departure.count({ where: { tourId: tour1.id } })) === 0) {
    await prisma.departure.createMany({
      data: [
        { tourId: tour1.id, startDate: daysFromNow(14), capacity: 12, instantConfirm: false },
        { tourId: tour1.id, startDate: daysFromNow(28), capacity: 12, instantConfirm: true },
      ],
    });
  }
  if ((await prisma.departure.count({ where: { tourId: tour2.id } })) === 0) {
    await prisma.departure.create({
      data: { tourId: tour2.id, startDate: daysFromNow(7), capacity: 8, instantConfirm: true, priceOverride: 400_000 },
    });
  }

  // --- A completed booking + review, so ratings are real (not hard-coded) ---
  const existingReview = await prisma.review.findUnique({
    where: { tourId_userId: { tourId: tour1.id, userId: traveller.id } },
  });
  if (!existingReview) {
    const booking = await prisma.booking.create({
      data: {
        reference: 'TM-SEED01',
        tourId: tour1.id,
        userId: traveller.id,
        status: 'COMPLETED',
        startDate: daysFromNow(-10),
        completedAt: daysFromNow(-8),
        respondedAt: daysFromNow(-20),
        peopleCount: 2,
        totalPrice: 3_000_000,
        currency: 'UZS',
        contactName: 'Aziz Karimov',
        contactPhone: '+998 90 000 11 22',
        contactEmail: 'traveller@example.uz',
      },
    });
    await prisma.review.create({
      data: {
        tourId: tour1.id,
        userId: traveller.id,
        bookingId: booking.id,
        rating: 5,
        comment: 'Unforgettable — our guide was superb and the Registan at sunset was magical.',
        firmReply: 'Thank you, Aziz! We hope to host you again.',
      },
    });
    // A CAPTURED payment for the completed booking (commission split at 10%).
    await prisma.payment.create({
      data: {
        bookingId: booking.id,
        provider: 'MOCK',
        status: 'CAPTURED',
        amount: 3_000_000,
        currency: 'UZS',
        commissionAmount: 300_000,
        netAmount: 2_700_000,
        authorizedAt: daysFromNow(-20),
        capturedAt: daysFromNow(-8),
        providerRef: 'mock_seed01',
      },
    });
  }

  // Recompute tour1 rating aggregates from its reviews.
  const agg = await prisma.review.aggregate({
    where: { tourId: tour1.id },
    _avg: { rating: true },
    _count: { rating: true },
  });
  await prisma.tour.update({
    where: { id: tour1.id },
    data: {
      ratingAvg: agg._avg.rating ? Number(agg._avg.rating.toFixed(2)) : 0,
      ratingCount: agg._count.rating,
    },
  });

  console.log('Seed complete.');
  console.log('  Admin     : admin@tourmarket.uz');
  console.log('  Firm      : firm@silkroad.uz (verified) / firm@oasis.uz (pending)');
  console.log('  Traveller : traveller@example.uz');
  console.log('  Password  : Password123!');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
