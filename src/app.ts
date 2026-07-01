import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { pinoHttp } from 'pino-http';
import { env } from './config/env.js';
import { logger } from './lib/logger.js';
import { notFound, errorHandler } from './middleware/error.js';

import authRoutes from './modules/auth/auth.routes.js';
import tourRoutes from './modules/tours/tour.routes.js';
import firmRoutes from './modules/firms/firm.routes.js';
import bookingRoutes from './modules/bookings/booking.routes.js';
import metaRoutes from './modules/meta.routes.js';

export function createApp() {
  const app = express();

  app.set('trust proxy', 1); // correct req.ip behind a reverse proxy
  app.use(helmet());
  app.use(
    cors({
      origin: env.CORS_ORIGIN.split(',').map((s) => s.trim()),
      credentials: true,
    })
  );
  app.use(express.json({ limit: '1mb' }));
  app.use(pinoHttp({ logger }));

  // Global soft rate limit; sensitive routes add stricter limits of their own.
  app.use(
    rateLimit({ windowMs: 60 * 1000, max: 300, standardHeaders: true, legacyHeaders: false })
  );

  app.get('/health', (_req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

  const api = express.Router();
  api.use('/auth', authRoutes);
  api.use('/tours', tourRoutes);
  api.use('/firms', firmRoutes);
  api.use('/bookings', bookingRoutes);
  api.use('/meta', metaRoutes);
  app.use('/api/v1', api);

  app.use(notFound);
  app.use(errorHandler);

  return app;
}
