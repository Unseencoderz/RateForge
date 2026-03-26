import { HTTP_STATUS_INTERNAL_SERVER_ERROR } from '@rateforge/types';

import { getErrorMeta, getRequestLogger } from '../utils/logger';

import type { ApiResponse } from '@rateforge/types';
import type { Request, Response, NextFunction } from 'express';

/**
 * Centralised error handler.
 *
 * ⚠️  Must be the LAST middleware registered in app.ts.
 * Catches any error forwarded via next(err) and maps it to ApiResponse shape.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  const message = err instanceof Error ? err.message : 'Internal server error';
  getRequestLogger(req).error({
    message: 'Unhandled request error',
    event: 'http.request.error',
    path: req.originalUrl,
    method: req.method,
    ...getErrorMeta(err),
  });
  const body: ApiResponse<never> = {
    success: false,
    error: { code: 'INTERNAL_ERROR', message },
  };
  res.status(HTTP_STATUS_INTERNAL_SERVER_ERROR).json(body);
}
