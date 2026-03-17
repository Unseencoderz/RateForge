import { jest } from '@jest/globals';

import { sendRateLimitResponse } from './rate-limit-response';

import type { RateLimitResult } from '@rateforge/types';


// ── Helpers ──────────────────────────────────────────────────────────────────

const NOW_MS = 1_700_000_000_000; // fixed epoch for predictable assertions

function createMockRes() {
  const headers: Record<string, string | number> = {};
  const status = jest.fn().mockReturnThis() as jest.Mock;
  const json = jest.fn().mockReturnThis() as jest.Mock;
  const setHeader = jest.fn((key: string, value: string | number) => {
    headers[key] = value;
  }) as jest.Mock;

  return { status, json, setHeader, headers } as any;
}

function createReqWithResult(result: RateLimitResult | undefined) {
  return { rateLimitResult: result } as any;
}

const createNext = () => jest.fn();

// ── Tests ────────────────────────────────────────────────────────────────────

describe('sendRateLimitResponse middleware (P2-M3-T2)', () => {
  beforeEach(() => {
    jest.spyOn(Date, 'now').mockReturnValue(NOW_MS);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ── Allowed requests ───────────────────────────────────────────────────────

  describe('when the request is allowed', () => {
    const allowedResult: RateLimitResult = {
      allowed: true,
      limit: 60,
      remaining: 42,
      resetAt: NOW_MS + 30_000,
      ruleId: 'default'
    };

    it('sets X-RateLimit-Limit header', () => {
      const req = createReqWithResult(allowedResult);
      const res = createMockRes();
      const next = createNext();

      sendRateLimitResponse(req, res, next);

      expect(res.setHeader).toHaveBeenCalledWith('X-RateLimit-Limit', 60);
    });

    it('sets X-RateLimit-Remaining header', () => {
      const req = createReqWithResult(allowedResult);
      const res = createMockRes();
      const next = createNext();

      sendRateLimitResponse(req, res, next);

      expect(res.setHeader).toHaveBeenCalledWith('X-RateLimit-Remaining', 42);
    });

    it('sets X-RateLimit-Reset header in epoch seconds (not ms)', () => {
      const req = createReqWithResult(allowedResult);
      const res = createMockRes();
      const next = createNext();

      sendRateLimitResponse(req, res, next);

      const expectedResetSeconds = Math.ceil((NOW_MS + 30_000) / 1_000);
      expect(res.setHeader).toHaveBeenCalledWith('X-RateLimit-Reset', expectedResetSeconds);
    });

    it('sets X-RateLimit-Rule header when ruleId is present', () => {
      const req = createReqWithResult(allowedResult);
      const res = createMockRes();
      const next = createNext();

      sendRateLimitResponse(req, res, next);

      expect(res.setHeader).toHaveBeenCalledWith('X-RateLimit-Rule', 'default');
    });

    it('calls next() and does NOT send a response body', () => {
      const req = createReqWithResult(allowedResult);
      const res = createMockRes();
      const next = createNext();

      sendRateLimitResponse(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
      expect(next).toHaveBeenCalledWith();
      expect(res.status).not.toHaveBeenCalled();
      expect(res.json).not.toHaveBeenCalled();
    });
  });

  // ── Blocked requests ───────────────────────────────────────────────────────

  describe('when the request is blocked', () => {
    const blockedResult: RateLimitResult = {
      allowed: false,
      limit: 60,
      remaining: 0,
      resetAt: NOW_MS + 45_000,
      retryAfterMs: 45_000,
      ruleId: 'default',
      reason: 'TOKEN_BUCKET_EXHAUSTED'
    };

    it('sends HTTP 429', () => {
      const req = createReqWithResult(blockedResult);
      const res = createMockRes();
      const next = createNext();

      sendRateLimitResponse(req, res, next);

      expect(res.status).toHaveBeenCalledWith(429);
    });

    it('sends a structured ApiResponse body with code RATE_LIMIT_EXCEEDED', () => {
      const req = createReqWithResult(blockedResult);
      const res = createMockRes();
      const next = createNext();

      sendRateLimitResponse(req, res, next);

      const body = (res.json as jest.Mock).mock.calls[0][0] as any;
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('RATE_LIMIT_EXCEEDED');
      expect(body.error.retryAfterMs).toBe(45_000);
    });

    it('sets Retry-After header in seconds (ceiling of retryAfterMs / 1000)', () => {
      const req = createReqWithResult(blockedResult);
      const res = createMockRes();

      sendRateLimitResponse(req, res, createNext());

      expect(res.setHeader).toHaveBeenCalledWith('Retry-After', 45);
    });

    it('still sets the three X-RateLimit-* headers when blocked', () => {
      const req = createReqWithResult(blockedResult);
      const res = createMockRes();

      sendRateLimitResponse(req, res, createNext());

      expect(res.setHeader).toHaveBeenCalledWith('X-RateLimit-Limit', 60);
      expect(res.setHeader).toHaveBeenCalledWith('X-RateLimit-Remaining', 0);
    });

    it('does NOT call next() after sending a 429', () => {
      const req = createReqWithResult(blockedResult);
      const res = createMockRes();
      const next = createNext();

      sendRateLimitResponse(req, res, next);

      expect(next).not.toHaveBeenCalled();
    });

    it('derives Retry-After from resetAt when retryAfterMs is absent', () => {
      const result: RateLimitResult = {
        ...blockedResult,
        retryAfterMs: undefined
      };
      const req = createReqWithResult(result);
      const res = createMockRes();

      sendRateLimitResponse(req, res, createNext());

      // resetAt = NOW_MS + 45_000 → resetSeconds = ceil((NOW_MS+45000)/1000)
      // now = NOW_MS → nowSeconds = ceil(NOW_MS/1000)
      // retryAfter = resetSeconds - nowSeconds = 45
      const resetSeconds = Math.ceil((NOW_MS + 45_000) / 1_000);
      const nowSeconds = Math.ceil(NOW_MS / 1_000);
      expect(res.setHeader).toHaveBeenCalledWith('Retry-After', resetSeconds - nowSeconds);
    });
  });

  // ── Infinity / no-rule-matched edge case ──────────────────────────────────

  describe('when result has Infinity values (no rule matched / fail-open)', () => {
    const infiniteResult: RateLimitResult = {
      allowed: true,
      limit: Infinity,
      remaining: Infinity,
      resetAt: NOW_MS + 60_000,
      reason: 'NO_RULE_MATCHED'
    };

    it('omits X-RateLimit-Limit and X-RateLimit-Remaining headers', () => {
      const req = createReqWithResult(infiniteResult);
      const res = createMockRes();

      sendRateLimitResponse(req, res, createNext());

      const headerKeys = (res.setHeader as jest.Mock).mock.calls.map(
        (c: any[]) => c[0] as string
      );
      expect(headerKeys).not.toContain('X-RateLimit-Limit');
      expect(headerKeys).not.toContain('X-RateLimit-Remaining');
    });

    it('still sets X-RateLimit-Reset and calls next()', () => {
      const req = createReqWithResult(infiniteResult);
      const res = createMockRes();
      const next = createNext();

      sendRateLimitResponse(req, res, next);

      expect(res.setHeader).toHaveBeenCalledWith(
        'X-RateLimit-Reset',
        Math.ceil((NOW_MS + 60_000) / 1_000)
      );
      expect(next).toHaveBeenCalledTimes(1);
    });
  });

  // ── Missing result guard ───────────────────────────────────────────────────

  describe('when req.rateLimitResult is undefined (pipeline misconfiguration)', () => {
    it('calls next() and does not crash', () => {
      const req = createReqWithResult(undefined);
      const res = createMockRes();
      const next = createNext();

      sendRateLimitResponse(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
      expect(res.status).not.toHaveBeenCalled();
    });
  });
});
