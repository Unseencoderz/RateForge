import { recordBlockedRequest, recordHttpRequest } from '../metrics/registry';
import { getRequestLogger } from '../utils/logger';

import type { NextFunction, Request, Response } from 'express';

function getRequestPath(req: Request): string {
  return (req.originalUrl || `${req.baseUrl}${req.path}` || '/').split('?')[0];
}

export function logRequests(req: Request, res: Response, next: NextFunction): void {
  const startedAt = process.hrtime.bigint();
  const requestLogger = getRequestLogger(req);
  let finished = false;

  res.on('finish', () => {
    finished = true;

    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
    const rateLimitResult = req.rateLimitResult;
    const clientIdentity = req.clientIdentity;
    const clientId =
      clientIdentity?.userId && clientIdentity.userId !== 'anonymous'
        ? clientIdentity.userId
        : clientIdentity?.ip;

    recordHttpRequest(req, res.statusCode, durationMs);

    if (rateLimitResult && !rateLimitResult.allowed) {
      recordBlockedRequest(req, rateLimitResult.reason, rateLimitResult.ruleId);
    }

    requestLogger.log({
      level: res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info',
      message: 'HTTP request completed',
      event: 'http.request.completed',
      method: req.method,
      path: getRequestPath(req),
      route: req.route?.path,
      statusCode: res.statusCode,
      durationMs: Number(durationMs.toFixed(3)),
      ip: clientIdentity?.ip ?? req.ip ?? req.socket?.remoteAddress,
      userId: clientIdentity?.userId,
      tier: clientIdentity?.tier,
      clientId,
      allowed: rateLimitResult?.allowed,
      ruleId: rateLimitResult?.ruleId,
      reason: rateLimitResult?.reason,
    });
  });

  res.on('close', () => {
    if (finished) {
      return;
    }

    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;

    requestLogger.warn({
      message: 'HTTP request closed before a response was sent',
      event: 'http.request.aborted',
      method: req.method,
      path: getRequestPath(req),
      durationMs: Number(durationMs.toFixed(3)),
    });
  });

  next();
}
