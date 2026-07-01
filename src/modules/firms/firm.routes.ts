import { z } from 'zod';
import type { Request, Response } from 'express';
import { Router } from 'express';
import { prisma } from '../../lib/prisma.js';
import { ApiError } from '../../utils/apiError.js';
import { catchAsync } from '../../utils/catchAsync.js';
import { validate } from '../../middleware/validate.js';
import { authenticate } from '../../middleware/authenticate.js';
import { authorize } from '../../middleware/authorize.js';

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

const verifySchema = z.object({
  status: z.enum(['VERIFIED', 'SUSPENDED', 'REJECTED', 'PENDING']),
});

const router = Router();

// --- Public: view a firm profile and its published tours ---
router.get(
  '/:slug',
  catchAsync(async (req: Request, res: Response) => {
    const firm = await prisma.firm.findUnique({
      where: { slug: req.params.slug },
      select: {
        id: true, name: true, slug: true, description: true, logoUrl: true,
        coverUrl: true, website: true, phone: true, status: true, createdAt: true,
        tours: {
          where: { status: 'PUBLISHED', deletedAt: null },
          select: { id: true, slug: true, title: true, priceFrom: true, currency: true, images: true, ratingAvg: true },
        },
      },
    });
    if (!firm || firm.status === 'REJECTED') throw ApiError.notFound('Firm not found');
    res.json(firm);
  })
);

// --- Firm: manage own profile ---
router.patch(
  '/me/profile',
  authenticate,
  authorize('FIRM'),
  validate({ body: updateFirmSchema }),
  catchAsync(async (req: Request, res: Response) => {
    const firm = await prisma.firm.findUnique({ where: { ownerId: req.auth!.userId } });
    if (!firm) throw ApiError.notFound('Firm profile not found');
    const updated = await prisma.firm.update({ where: { id: firm.id }, data: req.body });
    res.json(updated);
  })
);

// --- Admin: list firms + change verification status ---
router.get(
  '/',
  authenticate,
  authorize('ADMIN'),
  catchAsync(async (_req: Request, res: Response) => {
    res.json(
      await prisma.firm.findMany({
        orderBy: { createdAt: 'desc' },
        include: { owner: { select: { email: true } }, _count: { select: { tours: true } } },
      })
    );
  })
);

router.post(
  '/:id/verify',
  authenticate,
  authorize('ADMIN'),
  validate({ body: verifySchema }),
  catchAsync(async (req: Request, res: Response) => {
    const updated = await prisma.firm.update({
      where: { id: req.params.id },
      data: {
        status: req.body.status,
        verifiedAt: req.body.status === 'VERIFIED' ? new Date() : null,
      },
    });
    res.json(updated);
  })
);

export default router;
