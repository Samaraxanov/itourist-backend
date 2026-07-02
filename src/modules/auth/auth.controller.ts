import type { Request, Response } from 'express';
import * as authService from './auth.service.js';
import { catchAsync } from '../../utils/catchAsync.js';

const meta = (req: Request) => ({
  userAgent: req.headers['user-agent'],
  ip: req.ip,
});

export const register = catchAsync(async (req: Request, res: Response) => {
  const result = await authService.register(req.body, meta(req));
  res.status(201).json(result);
});

export const login = catchAsync(async (req: Request, res: Response) => {
  const result = await authService.login(req.body, meta(req));
  res.json(result);
});

export const telegram = catchAsync(async (req: Request, res: Response) => {
  const result = await authService.telegramAuth(req.body.initData, meta(req));
  res.json(result);
});

export const refresh = catchAsync(async (req: Request, res: Response) => {
  const result = await authService.refresh(req.body.refreshToken, meta(req));
  res.json(result);
});

export const logout = catchAsync(async (req: Request, res: Response) => {
  await authService.logout(req.body.refreshToken);
  res.status(204).send();
});

export const me = catchAsync(async (req: Request, res: Response) => {
  const result = await authService.me(req.auth!.userId);
  res.json(result);
});
