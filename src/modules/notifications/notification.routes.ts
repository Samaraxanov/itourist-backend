import { Router } from 'express';
import type { Request, Response } from 'express';
import { catchAsync } from '../../utils/catchAsync.js';
import { authenticate } from '../../middleware/authenticate.js';
import * as service from './notification.service.js';

const router = Router();

// All notification endpoints are personal to the authenticated user.
router.use(authenticate);

router.get(
  '/',
  catchAsync(async (req: Request, res: Response) => {
    const unreadOnly = req.query.unread === 'true';
    res.json(await service.listNotifications(req.auth!.userId, unreadOnly));
  })
);

router.get(
  '/unread-count',
  catchAsync(async (req: Request, res: Response) => {
    res.json({ count: await service.unreadCount(req.auth!.userId) });
  })
);

router.post(
  '/read-all',
  catchAsync(async (req: Request, res: Response) => {
    await service.markAllRead(req.auth!.userId);
    res.status(204).send();
  })
);

router.post(
  '/:id/read',
  catchAsync(async (req: Request, res: Response) => {
    await service.markRead(req.auth!.userId, req.params.id);
    res.status(204).send();
  })
);

export default router;
