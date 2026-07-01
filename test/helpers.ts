import argon2 from 'argon2';
import { prisma } from '../src/lib/prisma.js';

// Wipe all data between test files/suites. TRUNCATE ... CASCADE is fast and resets
// everything without dropping the schema.
export async function resetDb() {
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      "PaymentEvent","Payment","Review","Booking","Departure","Tour",
      "Notification","RefreshToken","Firm","Category","Region","User"
    RESTART IDENTITY CASCADE;
  `);
}

export async function makeUser(
  email: string,
  role: 'USER' | 'FIRM' | 'ADMIN' = 'USER',
  password = 'Password123!'
) {
  return prisma.user.create({
    data: { email, passwordHash: await argon2.hash(password, { type: argon2.argon2id }), role },
  });
}

export async function makeVerifiedFirm(email = 'firm@test.uz') {
  const owner = await makeUser(email, 'FIRM');
  const firm = await prisma.firm.create({
    data: { ownerId: owner.id, name: 'Test Firm', slug: `test-firm-${owner.id.slice(0, 6)}`, status: 'VERIFIED', verifiedAt: new Date() },
  });
  return { owner, firm };
}
