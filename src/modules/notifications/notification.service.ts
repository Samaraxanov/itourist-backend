import type { NotificationType, Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { logger } from '../../lib/logger.js';
import { env } from '../../config/env.js';

// Central notification service.
//
// One call persists an in-app notification AND fans out to external channels
// (email / SMS). The external channels are mocked: in this build they log a line
// via pino instead of hitting Eskiz / an SMTP provider. Swapping in a real
// provider is a change to `deliverExternal` only — callers never change.

interface NotifyInput {
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  data?: Prisma.InputJsonValue;
  // Optional external targets. When present and NOTIFY_CHANNEL !== 'off',
  // a delivery attempt is logged (mock). Real providers plug in here.
  email?: string | null;
  phone?: string | null;
}

function deliverExternal(input: NotifyInput) {
  if (env.NOTIFY_CHANNEL === 'off') return;
  if (input.email) {
    logger.info(
      { channel: 'email', to: input.email, subject: input.title },
      `[MOCK EMAIL] ${input.title} — ${input.body}`
    );
  }
  if (input.phone) {
    logger.info(
      { channel: 'sms', to: input.phone },
      `[MOCK SMS] ${input.title}: ${input.body}`
    );
  }
}

// Create + deliver. Never throws into the caller's critical path: a failed
// notification must not roll back a confirmed booking or captured payment.
export async function notify(input: NotifyInput) {
  try {
    const created = await prisma.notification.create({
      data: {
        userId: input.userId,
        type: input.type,
        title: input.title,
        body: input.body,
        data: input.data,
      },
    });
    deliverExternal(input);
    return created;
  } catch (err) {
    logger.error({ err, type: input.type, userId: input.userId }, 'notify failed');
    return null;
  }
}

export function listNotifications(userId: string, unreadOnly = false) {
  return prisma.notification.findMany({
    where: { userId, ...(unreadOnly ? { readAt: null } : {}) },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });
}

export function unreadCount(userId: string) {
  return prisma.notification.count({ where: { userId, readAt: null } });
}

export async function markRead(userId: string, id: string) {
  // updateMany scopes the write to the owner, so a user can't mark another's row.
  await prisma.notification.updateMany({
    where: { id, userId, readAt: null },
    data: { readAt: new Date() },
  });
}

export async function markAllRead(userId: string) {
  await prisma.notification.updateMany({
    where: { userId, readAt: null },
    data: { readAt: new Date() },
  });
}
