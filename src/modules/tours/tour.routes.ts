import { Router } from 'express';
import * as controller from './tour.controller.js';
import { validate } from '../../middleware/validate.js';
import { authenticate } from '../../middleware/authenticate.js';
import { authorize } from '../../middleware/authorize.js';
import {
  createTourSchema,
  updateTourSchema,
  listToursQuerySchema,
  tourParamsSchema,
  publishSchema,
} from './tour.schema.js';

const router = Router();

// --- Public browsing ---
router.get('/', validate({ query: listToursQuerySchema }), controller.list);

// --- Firm management (must come before '/:id' to avoid capture) ---
router.get('/mine', authenticate, authorize('FIRM'), controller.listMine);
router.post('/', authenticate, authorize('FIRM'), validate({ body: createTourSchema }), controller.create);
router.patch(
  '/:id',
  authenticate,
  authorize('FIRM'),
  validate({ params: tourParamsSchema, body: updateTourSchema }),
  controller.update
);
router.post(
  '/:id/publish',
  authenticate,
  authorize('FIRM'),
  validate({ params: tourParamsSchema, body: publishSchema }),
  controller.publish
);
router.delete(
  '/:id',
  authenticate,
  authorize('FIRM'),
  validate({ params: tourParamsSchema }),
  controller.remove
);

// --- Public single (id or slug) ---
router.get('/:id', validate({ params: tourParamsSchema }), controller.getOne);

export default router;
