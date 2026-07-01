import { z } from 'zod';
import { Router } from 'express';
import type { Request, Response } from 'express';
import { catchAsync } from '../../utils/catchAsync.js';
import { validate } from '../../middleware/validate.js';
import { authenticate } from '../../middleware/authenticate.js';
import { authorize } from '../../middleware/authorize.js';
import * as service from './admin.service.js';

const verifySchema = z.object({
  status: z.enum(['VERIFIED', 'SUSPENDED', 'REJECTED', 'PENDING']),
});
const featureSchema = z.object({
  days: z.number().int().min(0).max(365),
});

const router = Router();

// Every admin endpoint requires the ADMIN role.
router.use(authenticate, authorize('ADMIN'));

// --- Stats ---
router.get('/stats', catchAsync(async (_req: Request, res: Response) => {
  res.json(await service.platformStats());
}));

// --- Firm verification queue ---
router.get('/firms', catchAsync(async (req: Request, res: Response) => {
  const status = req.query.status as never;
  res.json(await service.listFirms(status));
}));

router.post('/firms/:id/verify', validate({ body: verifySchema }), catchAsync(async (req: Request, res: Response) => {
  res.json(await service.verifyFirm(req.params.id, req.body.status));
}));

// --- Tour moderation + promotion ---
router.get('/tours', catchAsync(async (_req: Request, res: Response) => {
  res.json(await service.listTours());
}));

router.post('/tours/:id/feature', validate({ body: featureSchema }), catchAsync(async (req: Request, res: Response) => {
  res.json(await service.setFeatured(req.params.id, req.body.days));
}));

router.post('/tours/:id/unpublish', catchAsync(async (req: Request, res: Response) => {
  res.json(await service.unpublishTour(req.params.id));
}));

// --- Payments oversight ---
router.get('/payments', catchAsync(async (_req: Request, res: Response) => {
  res.json(await service.listPayments());
}));

export default router;
