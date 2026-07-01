import type { Request, Response, NextFunction } from 'express';
import type { Role } from '@prisma/client';
import { ApiError } from '../utils/apiError.js';

// Role-based access control. Use after `authenticate`.
// Example: router.post('/', authenticate, authorize('FIRM', 'ADMIN'), handler)
export const authorize =
  (...roles: Role[]) =>
  (req: Request, _res: Response, next: NextFunction) => {
    if (!req.auth) throw ApiError.unauthorized();
    if (!roles.includes(req.auth.role)) {
      throw ApiError.forbidden('Insufficient permissions for this action');
    }
    next();
  };
