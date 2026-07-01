import { Router } from 'express';
import * as controller from './booking.controller.js';
import { validate } from '../../middleware/validate.js';
import { authenticate } from '../../middleware/authenticate.js';
import { authorize } from '../../middleware/authorize.js';
import { createBookingSchema, respondSchema } from './booking.schema.js';

const router = Router();

// --- Traveller ---
router.post('/', authenticate, validate({ body: createBookingSchema }), controller.create);
router.get('/mine', authenticate, controller.listMine);
router.post('/:id/cancel', authenticate, controller.cancel);

// --- Firm inbox ---
router.get('/firm', authenticate, authorize('FIRM'), controller.listFirm);
router.post('/:id/respond', authenticate, authorize('FIRM'), validate({ body: respondSchema }), controller.respond);
router.post('/:id/complete', authenticate, authorize('FIRM'), controller.complete);

export default router;
