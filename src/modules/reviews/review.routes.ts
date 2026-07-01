import { Router } from 'express';
import type { Request, Response } from 'express';
import { catchAsync } from '../../utils/catchAsync.js';
import { validate } from '../../middleware/validate.js';
import { authenticate } from '../../middleware/authenticate.js';
import { authorize } from '../../middleware/authorize.js';
import * as service from './review.service.js';
import { createReviewSchema, listReviewsQuerySchema, replySchema } from './review.schema.js';

const router = Router();

// --- Public: list reviews for a tour ---
router.get(
  '/',
  validate({ query: listReviewsQuerySchema }),
  catchAsync(async (req: Request, res: Response) => {
    res.json(await service.listTourReviews(req.query as never));
  })
);

// --- Traveller: leave a review for a completed booking ---
router.post(
  '/',
  authenticate,
  validate({ body: createReviewSchema }),
  catchAsync(async (req: Request, res: Response) => {
    res.status(201).json(await service.createReview(req.auth!.userId, req.body));
  })
);

// --- Firm: reply to a review on one of its tours ---
router.post(
  '/:id/reply',
  authenticate,
  authorize('FIRM'),
  validate({ body: replySchema }),
  catchAsync(async (req: Request, res: Response) => {
    res.json(await service.replyToReview(req.auth!.userId, req.params.id, req.body.reply));
  })
);

export default router;
