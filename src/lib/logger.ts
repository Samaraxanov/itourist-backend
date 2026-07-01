import { pino } from 'pino';
import { env, isProd } from '../config/env.js';

// Pretty transport only in local development. In production we emit structured
// JSON to stdout; under test we stay silent-ish and avoid the pino-pretty worker
// (which Vitest's worker threads can't spawn).
const isDev = env.NODE_ENV === 'development';

export const logger = pino(
  isDev
    ? { level: 'debug', transport: { target: 'pino-pretty', options: { colorize: true } } }
    : { level: isProd ? 'info' : 'silent' }
);
