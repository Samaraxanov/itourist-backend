import { z } from 'zod';
import { Router } from 'express';
import type { Request, Response } from 'express';
import { catchAsync } from '../../utils/catchAsync.js';
import { validate } from '../../middleware/validate.js';
import { authenticate } from '../../middleware/authenticate.js';
import * as service from './payment.service.js';

const createSchema = z.object({
  bookingId: z.string().min(1),
  provider: z.enum(['MOCK', 'PAYME', 'CLICK', 'UZUM']).default('MOCK'),
});

const webhookSchema = z.object({
  providerRef: z.string().min(1),
  event: z.enum(['authorized', 'captured', 'failed']),
});

const router = Router();

// --- Provider webhook (public; a real provider signs the payload) ---
router.post(
  '/webhook',
  validate({ body: webhookSchema }),
  catchAsync(async (req: Request, res: Response) => {
    res.json(await service.handleWebhook(req.body));
  })
);

// --- Traveller: start payment for a confirmed booking ---
router.post(
  '/',
  authenticate,
  validate({ body: createSchema }),
  catchAsync(async (req: Request, res: Response) => {
    res.status(201).json(await service.createForBooking(req.auth!.userId, req.body.bookingId, req.body.provider));
  })
);

// --- Traveller: read a booking's payment + event trail ---
router.get(
  '/booking/:bookingId',
  authenticate,
  catchAsync(async (req: Request, res: Response) => {
    res.json(await service.getForBooking(req.auth!.userId, req.params.bookingId));
  })
);

// --- Mock checkout: simulates the traveller completing provider payment ---
router.post(
  '/:id/mock-checkout',
  authenticate,
  catchAsync(async (req: Request, res: Response) => {
    res.json(await service.authorize(req.auth!.userId, req.params.id));
  })
);

export default router;
