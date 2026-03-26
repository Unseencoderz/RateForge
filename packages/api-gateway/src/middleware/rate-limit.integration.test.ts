/**
 * Rate limit middleware — Supertest integration tests
 *
 * Tests the FULL three-middleware pipeline as wired in the Express app:
 *
 *   applyRateLimit  →  sendRateLimitResponse  →  handler
 *
 * Strategy
 * ─────────
 * • `checkLimit` (RateLimitService) is mocked at the module level so tests
 *   never need a real Redis connection or JWT.
 * • `req.clientIdentity` is injected directly by a lightweight stub middleware
 *   instead of running the real JWT middleware — this keeps each piece
 *   independently testable and removes the JWT_SECRET dependency from this suite.
 * • A real Express app is constructed per-describe so each group starts with a
 *   fresh router.  Supertest drives real HTTP requests through the full stack.
 *
 * Header assertions use exact values derived from the mocked RateLimitResult
 * so that any drift in header formatting is immediately caught.
 */

import { jest } from '@jest/globals';
import express from 'express';
import request from 'supertest';

import type { RateLimitResult } from '@rateforge/types';

// ── Module mock: replace RateLimitService with a controllable stub ───────────

const checkLimitMock = jest.fn<() => Promise<RateLimitResult>>();
const isBlacklistedMock = jest.fn<() => Promise<boolean>>();
const isWhitelistedMock = jest.fn<() => Promise<boolean>>();

jest.mock('../services/rate-limiter.client', () => ({
  checkLimit: (...args: any[]) => (checkLimitMock as any)(...args),
  isBlacklisted: (...args: any[]) => (isBlacklistedMock as any)(...args),
  isWhitelisted: (...args: any[]) => (isWhitelistedMock as any)(...args),
}));

// ── Import AFTER mock registration ───────────────────────────────────────────

import { applyRateLimit } from './rate-limit';
import { sendRateLimitResponse } from './rate-limit-response';

// ── Shared test fixtures ─────────────────────────────────────────────────────

const FIXED_NOW = 1_700_000_000_000; // fixed epoch ms for deterministic assertions
const WINDOW_MS = 60_000;
const RESET_AT = FIXED_NOW + WINDOW_MS; // epoch ms
const RESET_AT_SECONDS = Math.ceil(RESET_AT / 1_000); // epoch seconds (header value)

const ALLOWED_RESULT: RateLimitResult = {
  allowed: true,
  limit: 60,
  remaining: 42,
  resetAt: RESET_AT,
  ruleId: 'default',
};

const BLOCKED_RESULT: RateLimitResult = {
  allowed: false,
  limit: 60,
  remaining: 0,
  resetAt: RESET_AT,
  retryAfterMs: 45_000,
  ruleId: 'default',
  reason: 'TOKEN_BUCKET_EXHAUSTED',
};

// ── Helper: build a minimal Express app with the two middlewares under test ──

function buildApp() {
  const app = express();

  // Stub auth: injects a pre-built clientIdentity so auth middleware is not
  // exercised here (it has its own unit test suite in auth.test.ts).
  app.use((req, _res, next) => {
    (req as any).clientIdentity = {
      userId: 'user-integration-test',
      ip: '127.0.0.1',
      tier: 'pro',
    };
    next();
  });

  app.use(applyRateLimit);
  app.use(sendRateLimitResponse);

  // Sentinel route — reached only when the request is allowed through
  app.get('/api/v1/test', (_req, res) => {
    res.status(200).json({ success: true, message: 'reached handler' });
  });

  return app;
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('P2-M3-T3 · Rate limit middleware integration (Supertest)', () => {
  beforeEach(() => {
    checkLimitMock.mockReset();
    isBlacklistedMock.mockReset();
    isWhitelistedMock.mockReset();
    isBlacklistedMock.mockResolvedValue(false);
    isWhitelistedMock.mockResolvedValue(false);
    jest.spyOn(Date, 'now').mockReturnValue(FIXED_NOW);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ── Allowed requests ───────────────────────────────────────────────────────

  describe('allowed request', () => {
    it('returns HTTP 200 and reaches the route handler', async () => {
      checkLimitMock.mockResolvedValueOnce(ALLOWED_RESULT);

      const res = await request(buildApp()).get('/api/v1/test');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true, message: 'reached handler' });
    });

    it('sets X-RateLimit-Limit to the rule limit', async () => {
      checkLimitMock.mockResolvedValueOnce(ALLOWED_RESULT);

      const res = await request(buildApp()).get('/api/v1/test');

      expect(res.headers['x-ratelimit-limit']).toBe('60');
    });

    it('sets X-RateLimit-Remaining to remaining tokens', async () => {
      checkLimitMock.mockResolvedValueOnce(ALLOWED_RESULT);

      const res = await request(buildApp()).get('/api/v1/test');

      expect(res.headers['x-ratelimit-remaining']).toBe('42');
    });

    it('sets X-RateLimit-Reset to epoch seconds (not milliseconds)', async () => {
      checkLimitMock.mockResolvedValueOnce(ALLOWED_RESULT);

      const res = await request(buildApp()).get('/api/v1/test');

      expect(res.headers['x-ratelimit-reset']).toBe(String(RESET_AT_SECONDS));
    });

    it('sets X-RateLimit-Rule to the matched rule id', async () => {
      checkLimitMock.mockResolvedValueOnce(ALLOWED_RESULT);

      const res = await request(buildApp()).get('/api/v1/test');

      expect(res.headers['x-ratelimit-rule']).toBe('default');
    });

    it('does NOT set Retry-After header', async () => {
      checkLimitMock.mockResolvedValueOnce(ALLOWED_RESULT);

      const res = await request(buildApp()).get('/api/v1/test');

      expect(res.headers['retry-after']).toBeUndefined();
    });
  });

  // ── Blocked requests ───────────────────────────────────────────────────────

  describe('blocked request', () => {
    it('returns HTTP 429', async () => {
      checkLimitMock.mockResolvedValueOnce(BLOCKED_RESULT);

      const res = await request(buildApp()).get('/api/v1/test');

      expect(res.status).toBe(429);
    });

    it('does NOT reach the route handler', async () => {
      checkLimitMock.mockResolvedValueOnce(BLOCKED_RESULT);

      const res = await request(buildApp()).get('/api/v1/test');

      // If the handler were reached the body would contain 'reached handler'
      expect(res.body?.message).not.toBe('reached handler');
    });

    it('returns a structured ApiResponse body with code RATE_LIMIT_EXCEEDED', async () => {
      checkLimitMock.mockResolvedValueOnce(BLOCKED_RESULT);

      const res = await request(buildApp()).get('/api/v1/test');

      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('RATE_LIMIT_EXCEEDED');
      expect(typeof res.body.error.message).toBe('string');
    });

    it('includes retryAfterMs in the response body', async () => {
      checkLimitMock.mockResolvedValueOnce(BLOCKED_RESULT);

      const res = await request(buildApp()).get('/api/v1/test');

      expect(res.body.error.retryAfterMs).toBe(45_000);
    });

    it('includes limit, remaining, and resetAt in error details', async () => {
      checkLimitMock.mockResolvedValueOnce(BLOCKED_RESULT);

      const res = await request(buildApp()).get('/api/v1/test');

      const { details } = res.body.error;
      expect(details.limit).toBe(60);
      expect(details.remaining).toBe(0);
      expect(details.resetAt).toBe(RESET_AT);
    });

    it('sets X-RateLimit-Limit header', async () => {
      checkLimitMock.mockResolvedValueOnce(BLOCKED_RESULT);

      const res = await request(buildApp()).get('/api/v1/test');

      expect(res.headers['x-ratelimit-limit']).toBe('60');
    });

    it('sets X-RateLimit-Remaining to 0', async () => {
      checkLimitMock.mockResolvedValueOnce(BLOCKED_RESULT);

      const res = await request(buildApp()).get('/api/v1/test');

      expect(res.headers['x-ratelimit-remaining']).toBe('0');
    });

    it('sets X-RateLimit-Reset to epoch seconds', async () => {
      checkLimitMock.mockResolvedValueOnce(BLOCKED_RESULT);

      const res = await request(buildApp()).get('/api/v1/test');

      expect(res.headers['x-ratelimit-reset']).toBe(String(RESET_AT_SECONDS));
    });

    it('sets Retry-After header in integer seconds (ceiling of retryAfterMs / 1000)', async () => {
      checkLimitMock.mockResolvedValueOnce(BLOCKED_RESULT);

      const res = await request(buildApp()).get('/api/v1/test');

      // 45_000 ms → 45 seconds
      expect(res.headers['retry-after']).toBe('45');
    });

    it('sets X-RateLimit-Rule header', async () => {
      checkLimitMock.mockResolvedValueOnce(BLOCKED_RESULT);

      const res = await request(buildApp()).get('/api/v1/test');

      expect(res.headers['x-ratelimit-rule']).toBe('default');
    });
  });

  // ── Fail-open: RateLimitService throws ────────────────────────────────────

  describe('when RateLimitService throws (Redis down)', () => {
    it('is fail-open: returns HTTP 200 and reaches the route handler', async () => {
      checkLimitMock.mockRejectedValueOnce(new Error('Redis ECONNREFUSED'));

      const res = await request(buildApp()).get('/api/v1/test');

      expect(res.status).toBe(200);
      expect(res.body.message).toBe('reached handler');
    });

    it('does not set Retry-After header on fail-open', async () => {
      checkLimitMock.mockRejectedValueOnce(new Error('Redis ECONNREFUSED'));

      const res = await request(buildApp()).get('/api/v1/test');

      expect(res.headers['retry-after']).toBeUndefined();
    });
  });

  // ── Blacklist / Whitelist behaviour ───────────────────────────────────────

  describe('blacklist / whitelist checks', () => {
    it('blacklisted IP returns HTTP 403 and does not call checkLimit()', async () => {
      isBlacklistedMock.mockResolvedValueOnce(true);
      isWhitelistedMock.mockResolvedValueOnce(false);
      checkLimitMock.mockResolvedValueOnce(ALLOWED_RESULT);

      const res = await request(buildApp()).get('/api/v1/test');

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('FORBIDDEN');
      expect(checkLimitMock).not.toHaveBeenCalled();
    });

    it('whitelisted IP bypasses checkLimit() and reaches handler', async () => {
      isBlacklistedMock.mockResolvedValueOnce(false);
      isWhitelistedMock.mockResolvedValueOnce(true);

      const res = await request(buildApp()).get('/api/v1/test');

      expect(res.status).toBe(200);
      expect(res.body.message).toBe('reached handler');
      expect(checkLimitMock).not.toHaveBeenCalled();
    });
  });

  // ── No-rule-matched: Infinity headers omitted ──────────────────────────────

  describe('when no rule matched (limit = Infinity)', () => {
    const noRuleResult: RateLimitResult = {
      allowed: true,
      limit: Infinity,
      remaining: Infinity,
      resetAt: RESET_AT,
      reason: 'NO_RULE_MATCHED',
    };

    it('returns HTTP 200', async () => {
      checkLimitMock.mockResolvedValueOnce(noRuleResult);

      const res = await request(buildApp()).get('/api/v1/test');

      expect(res.status).toBe(200);
    });

    it('omits X-RateLimit-Limit header (avoids sending "Infinity" to clients)', async () => {
      checkLimitMock.mockResolvedValueOnce(noRuleResult);

      const res = await request(buildApp()).get('/api/v1/test');

      expect(res.headers['x-ratelimit-limit']).toBeUndefined();
    });

    it('omits X-RateLimit-Remaining header', async () => {
      checkLimitMock.mockResolvedValueOnce(noRuleResult);

      const res = await request(buildApp()).get('/api/v1/test');

      expect(res.headers['x-ratelimit-remaining']).toBeUndefined();
    });

    it('still sets X-RateLimit-Reset', async () => {
      checkLimitMock.mockResolvedValueOnce(noRuleResult);

      const res = await request(buildApp()).get('/api/v1/test');

      expect(res.headers['x-ratelimit-reset']).toBe(String(RESET_AT_SECONDS));
    });
  });

  // ── Sequential requests: bucket depletion ─────────────────────────────────

  describe('sequential requests reflecting real bucket depletion', () => {
    it('allows requests while tokens remain then blocks on exhaustion', async () => {
      // Simulate a client that has one token left, then exhausts it
      checkLimitMock
        .mockResolvedValueOnce({
          allowed: true,
          limit: 2,
          remaining: 1,
          resetAt: RESET_AT,
          ruleId: 'tight',
        })
        .mockResolvedValueOnce({
          allowed: true,
          limit: 2,
          remaining: 0,
          resetAt: RESET_AT,
          ruleId: 'tight',
        })
        .mockResolvedValueOnce({
          allowed: false,
          limit: 2,
          remaining: 0,
          resetAt: RESET_AT,
          retryAfterMs: 30_000,
          ruleId: 'tight',
        });

      const app = buildApp();

      const r1 = await request(app).get('/api/v1/test');
      const r2 = await request(app).get('/api/v1/test');
      const r3 = await request(app).get('/api/v1/test');

      expect(r1.status).toBe(200);
      expect(r1.headers['x-ratelimit-remaining']).toBe('1');

      expect(r2.status).toBe(200);
      expect(r2.headers['x-ratelimit-remaining']).toBe('0');

      expect(r3.status).toBe(429);
      expect(r3.headers['retry-after']).toBe('30');
      expect(r3.body.error.code).toBe('RATE_LIMIT_EXCEEDED');
    });
  });

  // ── clientId derivation: userId vs IP ────────────────────────────────────

  describe('clientId derivation passed to RateLimitService', () => {
    it('uses userId from clientIdentity as the clientId', async () => {
      checkLimitMock.mockResolvedValueOnce(ALLOWED_RESULT);

      await request(buildApp()).get('/api/v1/test');

      const rlReq = (checkLimitMock as jest.Mock).mock.calls[0][0] as any;
      expect(rlReq.clientId).toBe('user-integration-test');
    });

    it('uses IP as clientId when clientIdentity is absent (anonymous)', async () => {
      checkLimitMock.mockResolvedValueOnce(ALLOWED_RESULT);

      const anonApp = express();
      // No clientIdentity stub — simulates a request that bypassed auth
      anonApp.use(applyRateLimit);
      anonApp.use(sendRateLimitResponse);
      anonApp.get('/api/v1/test', (_req, res) => res.status(200).json({ ok: true }));

      await request(anonApp).get('/api/v1/test');

      const rlReq = (checkLimitMock as jest.Mock).mock.calls[0][0] as any;
      // clientId falls back to IP (Express test runner uses ::ffff:127.0.0.1 or similar)
      expect(typeof rlReq.clientId).toBe('string');
      expect(rlReq.clientId.length).toBeGreaterThan(0);
    });
  });
});
