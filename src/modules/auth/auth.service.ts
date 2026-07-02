import { Prisma, type User } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { ApiError } from '../../utils/apiError.js';
import { hashPassword, verifyPassword } from '../../utils/password.js';
import {
  signAccessToken,
  generateRefreshToken,
  hashToken,
} from '../../utils/jwt.js';
import { slugify } from '../../utils/slugify.js';
import type { RegisterInput, LoginInput } from './auth.schema.js';

interface SessionMeta {
  userAgent?: string;
  ip?: string;
}

// Strip sensitive fields before returning a user to the client.
const publicUser = (u: User) => ({
  id: u.id,
  email: u.email,
  role: u.role,
  firstName: u.firstName,
  lastName: u.lastName,
  phone: u.phone,
  locale: u.locale,
});

async function issueSession(user: User, meta: SessionMeta) {
  const accessToken = signAccessToken({ sub: user.id, role: user.role, email: user.email });
  const { token, tokenHash, expiresAt } = generateRefreshToken();

  await prisma.refreshToken.create({
    data: { tokenHash, userId: user.id, expiresAt, userAgent: meta.userAgent, ip: meta.ip },
  });

  return { user: publicUser(user), accessToken, refreshToken: token };
}

export async function register(input: RegisterInput, meta: SessionMeta) {
  const existing = await prisma.user.findUnique({ where: { email: input.email } });
  if (existing) throw ApiError.conflict('Email is already registered');

  if (input.asFirm && !input.firmName) {
    throw ApiError.badRequest('firmName is required when registering as a firm');
  }

  const passwordHash = await hashPassword(input.password);

  // Create user (+ firm shell) atomically.
  const user = await prisma.$transaction(async (tx) => {
    const created = await tx.user.create({
      data: {
        email: input.email,
        passwordHash,
        firstName: input.firstName,
        lastName: input.lastName,
        phone: input.phone,
        locale: input.locale,
        role: input.asFirm ? 'FIRM' : 'USER',
      },
    });

    if (input.asFirm && input.firmName) {
      await tx.firm.create({
        data: {
          ownerId: created.id,
          name: input.firmName,
          slug: await uniqueFirmSlug(tx, input.firmName),
          email: input.email,
          status: 'PENDING', // admin must verify before publishing live tours
        },
      });
    }
    return created;
  });

  return issueSession(user, meta);
}

export async function login(input: LoginInput, meta: SessionMeta) {
  const user = await prisma.user.findUnique({ where: { email: input.email } });
  // Constant-ish behavior: same error whether email or password is wrong.
  if (!user || !user.isActive) throw ApiError.unauthorized('Invalid credentials');

  const ok = await verifyPassword(user.passwordHash, input.password);
  if (!ok) throw ApiError.unauthorized('Invalid credentials');

  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  return issueSession(user, meta);
}

// Refresh with rotation + reuse detection.
export async function refresh(rawToken: string, meta: SessionMeta) {
  const tokenHash = hashToken(rawToken);
  const stored = await prisma.refreshToken.findUnique({
    where: { tokenHash },
    include: { user: true },
  });

  if (!stored) throw ApiError.unauthorized('Invalid refresh token');

  // Reuse detection: a revoked token being presented again means it may be stolen.
  // Revoke the whole family (all of the user's tokens) as a safe default.
  if (stored.revokedAt) {
    await prisma.refreshToken.updateMany({
      where: { userId: stored.userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    throw ApiError.unauthorized('Refresh token reuse detected — please log in again');
  }

  if (stored.expiresAt < new Date()) {
    throw ApiError.unauthorized('Refresh token expired');
  }

  // Rotate: revoke the old token and issue a fresh pair.
  await prisma.refreshToken.update({
    where: { id: stored.id },
    data: { revokedAt: new Date() },
  });

  return issueSession(stored.user, meta);
}

export async function logout(rawToken: string) {
  const tokenHash = hashToken(rawToken);
  await prisma.refreshToken.updateMany({
    where: { tokenHash, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

export async function me(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { firm: { select: { id: true, name: true, slug: true, status: true, logoUrl: true } } },
  });
  if (!user) throw ApiError.notFound('User not found');
  return { ...publicUser(user), firm: user.firm };
}

// Generate a slug unique across firms.
async function uniqueFirmSlug(tx: Prisma.TransactionClient, name: string) {
  const base = slugify(name);
  let slug = base;
  let n = 1;
  // Loop until free. Realistically resolves in 1 iteration.
  while (await tx.firm.findUnique({ where: { slug } })) {
    slug = `${base}-${n++}`;
  }
  return slug;
}
