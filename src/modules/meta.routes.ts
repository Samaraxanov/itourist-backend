import { Router } from 'express';
import type { Request, Response } from 'express';
import { prisma } from '../../lib/prisma.js';
import { catchAsync } from '../../utils/catchAsync.js';

// Lightweight lookup data the frontend needs to render filters.
const router = Router();

router.get(
  '/categories',
  catchAsync(async (_req: Request, res: Response) => {
    res.json(await prisma.category.findMany({ select: { id: true, slug: true, name: true, icon: true } }));
  })
);

router.get(
  '/regions',
  catchAsync(async (_req: Request, res: Response) => {
    res.json(await prisma.region.findMany({ select: { id: true, slug: true, name: true } }));
  })
);

export default router;
