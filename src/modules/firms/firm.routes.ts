import { z } from 'zod';
import { Router } from 'express';
import type { Request, Response } from 'express';
import { catchAsync } from '../../utils/catchAsync.js';
import { validate } from '../../middleware/validate.js';
import { authenticate } from '../../middleware/authenticate.js';
import { authorize } from '../../middleware/authorize.js';
import * as service from './firm.service.js';

const updateFirmSchema = z.object({
  name: z.string().min(2).max(120).optional(),
  description: z
    .object({ uz: z.string().optional(), ru: z.string().optional(), en: z.string().optional() })
    .optional(),
  logoUrl: z.string().url().optional(),
  coverUrl: z.string().url().optional(),
  phone: z.string().min(5).max(30).optional(),
  website: z.string().url().optional(),
  address: z.string().max(300).optional(),
  licenseNo: z.string().max(80).optional(),
});

const router = Router();

// --- Firm: own analytics + profile (declared before '/:slug' to avoid capture) ---
router.get(
  '/me/analytics',
  authenticate,
  authorize('FIRM'),
  catchAsync(async (req: Request, res: Response) => {
    res.json(await service.analytics(req.auth!.userId));
  })
);

router.patch(
  '/me/profile',
  authenticate,
  authorize('FIRM'),
  validate({ body: updateFirmSchema }),
  catchAsync(async (req: Request, res: Response) => {
    res.json(await service.updateProfile(req.auth!.userId, req.body));
  })
);

// --- Public: view a firm profile and its published tours ---
router.get(
  '/:slug',
  catchAsync(async (req: Request, res: Response) => {
    res.json(await service.getPublicFirm(req.params.slug));
  })
);

export default router;
