import { randomUUID } from 'crypto';

import type { NextFunction, Request, Response } from 'express';

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

export function attachRequestId(req: Request, res: Response, next: NextFunction): void {
  const requestId = getHeaderValue(req.headers['x-request-id']) ?? randomUUID();
  const traceId = getHeaderValue(req.headers['x-trace-id']) ?? requestId;

  req.id = requestId;
  req.traceId = traceId;
  res.setHeader('X-Request-ID', requestId);
  res.setHeader('X-Trace-ID', traceId);

  next();
}
