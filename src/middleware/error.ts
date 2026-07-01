import type { Request, Response, NextFunction } from 'express';
import { Prisma } from '@prisma/client';
import { ApiError } from '../utils/apiError.js';
import { logger } from '../lib/logger.js';
import { captureException } from '../lib/observability.js';
import { isProd } from '../config/env.js';

export function notFound(_req: Request, _res: Response, next: NextFunction) {
  next(ApiError.notFound('Route not found'));
}

// Central error handler. Converts known error shapes into a consistent JSON body:
// { error: { code, message, details? } }
export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _next: NextFunction
) {
  let status = 500;
  let code = 'INTERNAL_ERROR';
  let message = 'Something went wrong';
  let details: unknown;

  if (err instanceof ApiError) {
    status = err.statusCode;
    code = err.code;
    message = err.message;
    details = err.details;
  } else if (err instanceof Prisma.PrismaClientKnownRequestError) {
    // Map common Prisma errors to friendly responses.
    if (err.code === 'P2002') {
      status = 409;
      code = 'CONFLICT';
      const target = (err.meta?.target as string[] | undefined)?.join(', ');
      message = `A record with this ${target ?? 'value'} already exists`;
    } else if (err.code === 'P2025') {
      status = 404;
      code = 'NOT_FOUND';
      message = 'Record not found';
    } else {
      status = 400;
      code = 'DB_ERROR';
      message = 'Database request failed';
    }
  }

  if (status >= 500) {
    logger.error({ err }, 'Unhandled error');
    captureException(err);
  }

  res.status(status).json({
    error: {
      code,
      message,
      ...(details ? { details } : {}),
      ...(isProd || status < 500 ? {} : { stack: (err as Error)?.stack }),
    },
  });
}
