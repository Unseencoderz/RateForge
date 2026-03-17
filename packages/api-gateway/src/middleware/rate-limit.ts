
import { AlgorithmType } from '@rateforge/types';

import { checkLimit } from '../services/rate-limiter.client';

import type { RateLimitRequest, RateLimitResult } from '@rateforge/types';
import type { Request, Response, NextFunction } from 'express';

/**
 * Extend Express Request so that downstream middleware and route handlers
 * can read the rate-limit result without re-running the check.
 */
declare global {
  namespace Express {
    interface Request {
      /**
       * Populated by `applyRateLimit` after a successful rate-limit check.
       * Will be `undefined` if the middleware has not yet run.
       */
      rateLimitResult?: RateLimitResult;
    }
  }
}

/**
 * P2-M3-T1 · Rate limit middleware.
 *
 * Responsibilities:
 *   1. Reads `req.clientIdentity` set by the JWT auth middleware (P2-M2-T1).
 *   2. Builds a `RateLimitRequest` from the incoming Express request.
 *   3. Calls `RateLimitService.checkLimit()` (P1-M5-T2).
 *   4. Attaches the returned `RateLimitResult` to `req.rateLimitResult`.
 *   5. Always calls `next()` — it does NOT send an HTTP response.
 *
 * ⚠️  Response handling (setting headers, sending 429) is implemented in the
 *     separate `rate-limit-response` middleware (P2-M3-T2).  Keeping the check
 *     and response separate makes each piece independently testable.
 *
 * ⚠️  This middleware must be registered AFTER `verifyToken` (P2-M2-T1) so
 *     that `req.clientIdentity` is guaranteed to be populated.
 */
export async function applyRateLimit(
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> {
  // Guard: if auth middleware did not run (misconfigured pipeline), treat
  // the client as anonymous rather than crashing.
  const identity = req.clientIdentity ?? {
    userId: 'anonymous',
    ip: req.ip ?? req.socket?.remoteAddress ?? '0.0.0.0',
    tier: 'free'
  };

  const rlRequest: RateLimitRequest = {
    // Composite client identifier: userId takes precedence over raw IP so that
    // authenticated users share a per-account limit across multiple IPs.
    clientId: identity.userId !== 'anonymous'
      ? identity.userId
      : identity.ip,
    identity,
    endpoint: req.path,
    method: req.method,
    timestamp: Date.now(),
    // The factory selects the concrete algorithm based on the matched rule;
    // passing TOKEN_BUCKET here is an advisory hint only.
    algorithm: AlgorithmType.TOKEN_BUCKET
  };

  try {
    const result = await checkLimit(rlRequest);
    req.rateLimitResult = result;
  } catch (err) {
    // Fail-open: if RateLimitService throws (e.g. Redis unreachable), allow
    // the request rather than blocking all traffic.
    // The error is forwarded to the error-handler middleware for logging.
    req.rateLimitResult = {
      allowed: true,
      limit: Infinity,
      remaining: Infinity,
      resetAt: rlRequest.timestamp + 60_000,
      reason: 'RATE_LIMIT_SERVICE_ERROR'
    };

    // Surface the error so the error-handler middleware can log / emit metrics.
    // We do NOT call next(err) because we still want the request to proceed.
    console.error('[rate-limit] RateLimitService error (fail-open):', err);
  }

  next();
}
