import {
  HTTP_STATUS_TOO_MANY_REQUESTS
} from '@rateforge/types';

import type { Request, Response, NextFunction } from 'express';


/**
 * P2-M3-T2 · Rate limit response handler middleware.
 *
 * Must be registered AFTER `applyRateLimit` (P2-M3-T1) in the middleware
 * pipeline so that `req.rateLimitResult` is guaranteed to be populated.
 *
 * Responsibilities:
 *   1. Set standard rate-limit headers on **every** response:
 *        X-RateLimit-Limit     — maximum requests allowed in the window
 *        X-RateLimit-Remaining — requests left in the current window
 *        X-RateLimit-Reset     — UTC epoch seconds at which the window resets
 *   2. When the request is **blocked** (`allowed === false`):
 *        - Add `Retry-After` header (seconds until the client may retry)
 *        - Send HTTP 429 with a structured `ApiResponse` body
 *        - Do NOT call `next()` — the pipeline ends here
 *   3. When the request is **allowed**, call `next()` unchanged.
 *
 * Header specification references:
 *  - X-RateLimit-*  : de-facto standard (nginx, GitHub, Stripe pattern)
 *  - Retry-After    : RFC 7231 §7.1.3 (integer seconds)
 *  - X-RateLimit-Reset follows the GitHub convention of UTC epoch *seconds*
 *    (not milliseconds) so that standard HTTP clients can parse it directly.
 */
export function sendRateLimitResponse(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const result = req.rateLimitResult;

  // Guard: if applyRateLimit did not run (pipeline misconfiguration) allow
  // the request through rather than crashing.  Log a warning so the
  // misconfiguration is visible in observability tooling.
  if (!result) {
    console.warn(
      '[rate-limit-response] req.rateLimitResult is undefined. ' +
      'Ensure applyRateLimit runs before sendRateLimitResponse.'
    );
    next();
    return;
  }

  // ── 1. Standard informational headers (always set) ───────────────────────
  //
  // Infinity arises when no rule matched or when the service failed open.
  // We omit those headers to avoid sending "Infinity" as a header value,
  // which would confuse HTTP clients.
  if (isFinite(result.limit)) {
    res.setHeader('X-RateLimit-Limit', result.limit);
  }

  if (isFinite(result.remaining)) {
    res.setHeader('X-RateLimit-Remaining', result.remaining);
  }

  // Convert epoch ms → epoch seconds (RFC-compatible, GitHub convention)
  const resetSeconds = Math.ceil(result.resetAt / 1_000);
  res.setHeader('X-RateLimit-Reset', resetSeconds);

  // Optional ruleId header to aid debugging (safe to expose; no secrets here)
  if (result.ruleId) {
    res.setHeader('X-RateLimit-Rule', result.ruleId);
  }

  // ── 2. Allowed: pass to next middleware ───────────────────────────────────
  if (result.allowed) {
    next();
    return;
  }

  // ── 3. Blocked: set Retry-After and send 429 ─────────────────────────────
  // Blacklisted requests should be forbidden (403), not rate-limited (429).
  if (result.reason === 'BLACKLISTED') {
    res.status(403).json({
      success: false,
      error: {
        code: 'FORBIDDEN',
        message: 'Your IP address has been blocked.',
      }
    });
    return;
  }

  //
  // RFC 7231 §7.1.3: Retry-After value is a delay in seconds (integer).
  const retryAfterSeconds = result.retryAfterMs !== undefined
    ? Math.ceil(result.retryAfterMs / 1_000)
    : Math.max(0, resetSeconds - Math.ceil(Date.now() / 1_000));

  res.setHeader('Retry-After', retryAfterSeconds);

  res.status(HTTP_STATUS_TOO_MANY_REQUESTS).json({
    success: false,
    error: {
      code: 'RATE_LIMIT_EXCEEDED',
      message: 'Too many requests. Please slow down.',
      retryAfterMs: result.retryAfterMs ?? retryAfterSeconds * 1_000,
      details: {
        limit: result.limit,
        remaining: result.remaining,
        resetAt: result.resetAt,
        ruleId: result.ruleId ?? null,
        reason: result.reason ?? 'RATE_LIMIT_EXCEEDED'
      }
    }
  });
  // Do NOT call next() — the response has been sent.
}
