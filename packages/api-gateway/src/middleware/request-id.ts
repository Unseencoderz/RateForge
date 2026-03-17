import { v4 as uuidv4 } from 'uuid';

import type { Request, Response, NextFunction } from 'express';

/**
 * P2-M1-T3 · Request ID middleware.
 *
 * Attaches a UUID v4 to `req.id` and sets the `X-Request-ID` response header
 * on every request. Used as the correlation ID in all logs and metrics.
 */
export function attachRequestId(req: Request, res: Response, next: NextFunction): void {
  const requestId = uuidv4();
  (req as Request & { id: string }).id = requestId;
  res.setHeader('X-Request-ID', requestId);
  next();
}
