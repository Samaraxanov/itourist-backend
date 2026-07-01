import { PrismaClient } from '@prisma/client';
import argon2 from 'argon2';

const prisma = new PrismaClient();

const ml = (uz: string, ru: string, en: string) => ({ uz, ru, en });

async function main() {
  const passwordHash = await argon2.hash('Password123!', { type: argon2.argon2id });

  // --- Admin ---
  await prisma.user.upsert({
    where: { email: 'admin@tourmarket.uz' },
    update: {},
    create: { email: 'admin@tourmarket.uz', passwordHash, role: 'ADMIN', firstName: 'Platform', lastName: 'Admin' },
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
      description: ml(
        'Oʻzbekiston boʻylab tajribali gidlar bilan sayohatlar.',
        'Путешествия по Узбекистану с опытными гидами.',
        'Tours across Uzbekistan with experienced local guides.'
      ),
    },
  });

  const samarkand = regions.find((r) => r.slug === 'samarkand')!;
  const cultural = categories.find((c) => c.slug === 'cultural')!;

  // --- Sample tours ---
  await prisma.tour.upsert({
    where: { slug: 'samarkand-highlights-2-days' },
    update: {},
    create: {
      firmId: firm.id,
      slug: 'samarkand-highlights-2-days',
      title: ml('Samarqand sayohati', 'Жемчужины Самарканда', 'Samarkand Highlights'),
      summary: ml(
        'Registon, Bibi-Xonim va Shohi Zinda 2 kunda.',
        'Регистан, Биби-Ханым и Шахи-Зинда за 2 дня.',
        'Registan, Bibi-Khanym and Shah-i-Zinda in two days.'
      ),
      description: ml(
        'Samarqandning eng mashhur yodgorliklari boʻylab toʻliq sayohat.',
        'Полное путешествие по знаменитым памятникам Самарканда.',
        'A complete journey through Samarkand’s most famous monuments with a licensed guide.'
      ),
      priceFrom: 1_500_000, // 1,500,000 UZS
      currency: 'UZS',
      durationDays: 2,
      maxGroupSize: 12,
      languages: ['uz', 'ru', 'en'],
      regionId: samarkand.id,
      categoryId: cultural.id,
      images: ['https://images.unsplash.com/photo-1602940659805-770d1b3b9911?w=1200'],
      status: 'PUBLISHED',
      publishedAt: new Date(),
      ratingAvg: 4.8,
      ratingCount: 24,
    },
  });

  await prisma.tour.upsert({
    where: { slug: 'bukhara-old-city-walk' },
    update: {},
    create: {
      firmId: firm.id,
      slug: 'bukhara-old-city-walk',
      title: ml('Buxoro eski shahri', 'Старый город Бухары', 'Bukhara Old City Walk'),
      summary: ml('Yarim kunlik piyoda sayohat.', 'Полудневная пешеходная экскурсия.', 'Half-day guided walking tour.'),
      priceFrom: 450_000,
      currency: 'UZS',
      durationDays: 1,
      durationHours: 4,
      languages: ['ru', 'en'],
      regionId: regions.find((r) => r.slug === 'bukhara')!.id,
      categoryId: categories.find((c) => c.slug === 'city')!.id,
      images: ['https://images.unsplash.com/photo-1631793984637-6c47b3f9dc2f?w=1200'],
      status: 'PUBLISHED',
      publishedAt: new Date(),
      ratingAvg: 4.6,
      ratingCount: 11,
    },
  });

  console.log('Seed complete. Login: admin@tourmarket.uz / firm@silkroad.uz — password: Password123!');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
