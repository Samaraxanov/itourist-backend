import type { Request, Response } from 'express';
import * as service from './tour.service.js';
import { catchAsync } from '../../utils/catchAsync.js';

// Public
export const list = catchAsync(async (req: Request, res: Response) => {
  res.json(await service.listPublicTours(req.query as any));
});

export const getOne = catchAsync(async (req: Request, res: Response) => {
  res.json(await service.getPublicTour(req.params.id));
});

// Firm-scoped
export const listMine = catchAsync(async (req: Request, res: Response) => {
  res.json(await service.listFirmTours(req.auth!.userId));
});

export const create = catchAsync(async (req: Request, res: Response) => {
  res.status(201).json(await service.createTour(req.auth!.userId, req.body));
});

export const update = catchAsync(async (req: Request, res: Response) => {
  res.json(await service.updateTour(req.auth!.userId, req.params.id, req.body));
});

export const publish = catchAsync(async (req: Request, res: Response) => {
  res.json(await service.setPublishState(req.auth!.userId, req.params.id, req.body.publish));
});

export const remove = catchAsync(async (req: Request, res: Response) => {
  await service.deleteTour(req.auth!.userId, req.params.id);
  res.status(204).send();
});
