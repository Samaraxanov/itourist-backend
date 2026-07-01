import { env } from '../config/env.js';
import { logger } from './logger.js';

// Error-tracking seam. When SENTRY_DSN is set in production you'd initialise the
// Sentry SDK here; without it (and in this build) captureException is a logging
// no-op. Keeping the seam means wiring real Sentry later touches only this file.
const enabled = Boolean(env.SENTRY_DSN);

if (enabled) {
  logger.info('Error tracking enabled (Sentry DSN present)');
}

export function captureException(err: unknown, context?: Record<string, unknown>) {
  if (enabled) {
    // e.g. Sentry.captureException(err, { extra: context })
    logger.warn({ err, context }, '[observability] would report to Sentry');
  }
}
