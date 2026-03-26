import { v4 as uuidv4 } from 'uuid';

import type { Request, Response, NextFunction } from 'express';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      id?: string;
      traceId?: string;
    }
  }
}

function getHeaderValue(header: string | string[] | undefined): string | undefined {
  if (Array.isArray(header)) {
    return header.find((value) => value.trim() !== '')?.trim();
  }

  if (typeof header === 'string' && header.trim() !== '') {
    return header.trim();
  }

  return undefined;
}

/**
 * Request ID middleware.
 *
 * Attaches a UUID v4 to `req.id` and sets the `X-Request-ID` response header
 * on every request. Used as the correlation ID in all logs and metrics.
 */
export function attachRequestId(req: Request, res: Response, next: NextFunction): void {
  const requestId = getHeaderValue(req.headers['x-request-id']) ?? uuidv4();
  const traceId = getHeaderValue(req.headers['x-trace-id']) ?? requestId;

  req.id = requestId;
  req.traceId = traceId;
  res.setHeader('X-Request-ID', requestId);
  res.setHeader('X-Trace-ID', traceId);
  next();
}
