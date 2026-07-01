import { Router } from 'express';
import type { Request, Response } from 'express';
import { catchAsync } from '../../utils/catchAsync.js';
import { validate } from '../../middleware/validate.js';
import { authenticate } from '../../middleware/authenticate.js';
import { authorize } from '../../middleware/authorize.js';
import * as service from './departure.service.js';
import {
  createDepartureSchema,
  updateDepartureSchema,
  listPublicDeparturesQuerySchema,
} from './departure.schema.js';

const router = Router();

// --- Public: open departures for a tour ---
router.get(
  '/',
  validate({ query: listPublicDeparturesQuerySchema }),
  catchAsync(async (req: Request, res: Response) => {
    res.json(await service.listPublic(String(req.query.tourId)));
  })
);

// --- Firm: manage departures for one of its tours ---
router.get(
  '/tour/:tourId',
  authenticate,
  authorize('FIRM'),
  catchAsync(async (req: Request, res: Response) => {
    res.json(await service.listForFirm(req.auth!.userId, req.params.tourId));
  })
);

router.post(
  '/',
  authenticate,
  authorize('FIRM'),
  validate({ body: createDepartureSchema }),
  catchAsync(async (req: Request, res: Response) => {
    res.status(201).json(await service.create(req.auth!.userId, req.body));
  })
);

router.patch(
  '/:id',
  authenticate,
  authorize('FIRM'),
  validate({ body: updateDepartureSchema }),
  catchAsync(async (req: Request, res: Response) => {
    res.json(await service.update(req.auth!.userId, req.params.id, req.body));
  })
);

router.delete(
  '/:id',
  authenticate,
  authorize('FIRM'),
  catchAsync(async (req: Request, res: Response) => {
    res.json(await service.cancel(req.auth!.userId, req.params.id));
  })
);

export default router;
