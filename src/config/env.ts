import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(4000),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
  DATABASE_URL: z.string().url(),
  JWT_ACCESS_SECRET: z.string().min(16),
  JWT_REFRESH_SECRET: z.string().min(16),
  ACCESS_TOKEN_TTL: z.string().default('15m'),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().default(30),

  // Platform commission taken from each captured payment (percent, 0..100).
  PLATFORM_COMMISSION_PCT: z.coerce.number().min(0).max(100).default(10),
  // Local uploads directory (mock object storage). Served statically at /uploads.
  UPLOAD_DIR: z.string().default('uploads'),
  // Absolute base URL used to build upload URLs and the sitemap.
  PUBLIC_BASE_URL: z.string().url().default('http://localhost:4000'),
  // Notification delivery channel: 'log' mocks email/SMS to the logger, 'off' disables.
  NOTIFY_CHANNEL: z.enum(['log', 'off']).default('log'),
  // Optional Sentry DSN; when absent, error tracking is a no-op.
  SENTRY_DSN: z.string().optional(),

  // Telegram Mini App: bot token (from @BotFather) used to verify initData.
  // When absent, the /auth/telegram endpoint is disabled.
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  // Comma-separated Telegram user IDs that should be treated as platform admins.
  TELEGRAM_ADMIN_IDS: z.string().default(''),
  // The public HTTPS URL of the Mini App (used by the bot setup script).
  TELEGRAM_WEBAPP_URL: z.string().optional(),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  // Fail fast: a misconfigured server should never start.
  console.error('Invalid environment variables:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
export const isProd = env.NODE_ENV === 'production';
