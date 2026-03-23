import { JWT_SECRET } from '@rateforge/config';

import { verifyInternalServiceHeaders } from '../utils/internal-service-auth';

import type { NextFunction, Request, Response } from 'express';

// eslint-disable-next-line @typescript-eslint/no-namespace
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      internalService?: string;
    }
  }
}

export function requireInternalService(req: Request, res: Response, next: NextFunction): void {
  const verification = verifyInternalServiceHeaders({
    headers: req.headers,
    method: req.method,
    path: req.originalUrl,
    secret: JWT_SECRET,
  });

  if (!verification.ok) {
    res.status(401).json({
      success: false,
      error: {
        code: 'UNAUTHORIZED',
        message: verification.error,
      },
    });
    return;
  }

  req.internalService = verification.service;
  next();
}
