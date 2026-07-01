import type { Request, Response, NextFunction, RequestHandler } from 'express';

// Wraps async route handlers so rejected promises reach the error middleware
// instead of crashing the process.
export const catchAsync =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler =>
  (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
