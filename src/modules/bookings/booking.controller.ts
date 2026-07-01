import type { Request, Response } from 'express';
import * as service from './booking.service.js';
import { catchAsync } from '../../utils/catchAsync.js';

export const create = catchAsync(async (req: Request, res: Response) => {
  res.status(201).json(await service.createBooking(req.auth!.userId, req.body));
});

export const listMine = catchAsync(async (req: Request, res: Response) => {
  res.json(await service.listMyBookings(req.auth!.userId));
});

export const listFirm = catchAsync(async (req: Request, res: Response) => {
  res.json(await service.listFirmBookings(req.auth!.userId));
});

export const respond = catchAsync(async (req: Request, res: Response) => {
  res.json(await service.respondToBooking(req.auth!.userId, req.params.id, req.body));
});

export const complete = catchAsync(async (req: Request, res: Response) => {
  res.json(await service.completeBooking(req.auth!.userId, req.params.id));
});

export const cancel = catchAsync(async (req: Request, res: Response) => {
  res.json(await service.cancelBooking(req.auth!.userId, req.params.id));
});
