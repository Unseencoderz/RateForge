import { jest } from '@jest/globals';

import { applyRateLimit } from './rate-limit';

import type { RateLimitResult } from '@rateforge/types';

// ── Middleware under test ────────────────────────────────────────────────────

// ── Mock RateLimitService ────────────────────────────────────────────────────
const checkLimitMock = jest.fn<() => Promise<RateLimitResult>>();

jest.mock('../services/rate-limiter.client', () => ({
  checkLimit:    (...args: any[]) => (checkLimitMock as any)(...args),
  isBlacklisted: jest.fn<() => Promise<boolean>>().mockResolvedValue(false),
  isWhitelisted: jest.fn<() => Promise<boolean>>().mockResolvedValue(false),
}));

// ── Helpers ──────────────────────────────────────────────────────────────────

function createMockReq(overrides: Record<string, unknown> = {}) {
  return {
    clientIdentity: {
      userId: 'user-abc',
      ip: '10.0.0.1',
      tier: 'pro'
    },
    path: '/api/v1/test',
    method: 'GET',
    ip: '10.0.0.1',
    socket: { remoteAddress: '10.0.0.1' },
    ...overrides
  } as any;
}

const createMockRes = () => ({}) as any;
const createNext = () => jest.fn();

// ── Tests ────────────────────────────────────────────────────────────────────

describe('applyRateLimit middleware (P2-M3-T1)', () => {
  beforeEach(() => {
    checkLimitMock.mockReset();
  });

  it('attaches the RateLimitResult to req and calls next() when allowed', async () => {
    const allowed: RateLimitResult = {
      allowed: true,
      limit: 60,
      remaining: 59,
      resetAt: Date.now() + 60_000,
      ruleId: 'default'
    };
    checkLimitMock.mockResolvedValueOnce(allowed);

    const req = createMockReq();
    const res = createMockRes();
    const next = createNext();

    await applyRateLimit(req, res, next);

    expect(req.rateLimitResult).toEqual(allowed);
    expect(next).toHaveBeenCalledTimes(1);
    // next() must be called with NO argument (not an error)
    expect(next).toHaveBeenCalledWith();
  });

  it('attaches the RateLimitResult to req and calls next() when denied', async () => {
    const denied: RateLimitResult = {
      allowed: false,
      limit: 60,
      remaining: 0,
      resetAt: Date.now() + 30_000,
      retryAfterMs: 30_000,
      ruleId: 'default',
      reason: 'TOKEN_BUCKET_EXHAUSTED'
    };
    checkLimitMock.mockResolvedValueOnce(denied);

    const req = createMockReq();
    const res = createMockRes();
    const next = createNext();

    await applyRateLimit(req, res, next);

    // Middleware must NOT send a response — just attach the result
    expect(req.rateLimitResult).toEqual(denied);
    expect(next).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledWith();
  });

  it('does NOT send any HTTP response regardless of the rate-limit decision', async () => {
    checkLimitMock.mockResolvedValueOnce({
      allowed: false,
      limit: 1,
      remaining: 0,
      resetAt: Date.now() + 1_000
    });

    const res = createMockRes() as { status?: jest.Mock; json?: jest.Mock; send?: jest.Mock };
    res.status = jest.fn().mockReturnThis();
    res.json = jest.fn().mockReturnThis();
    res.send = jest.fn().mockReturnThis();

    const req = createMockReq();
    const next = createNext();

    await applyRateLimit(req as any, res as any, next);

    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).not.toHaveBeenCalled();
    expect(res.send).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('uses userId as clientId when clientIdentity is present', async () => {
    checkLimitMock.mockResolvedValueOnce({
      allowed: true, limit: 60, remaining: 59, resetAt: Date.now() + 60_000
    });

    const req = createMockReq({ clientIdentity: { userId: 'u-999', ip: '1.2.3.4', tier: 'free' } });
    const next = createNext();

    await applyRateLimit(req, createMockRes(), next);

    const rlReq = (checkLimitMock as jest.Mock).mock.calls[0][0] as { clientId: string };
    expect(rlReq.clientId).toBe('u-999');
  });

  it('falls back to IP as clientId when clientIdentity is absent (anonymous)', async () => {
    checkLimitMock.mockResolvedValueOnce({
      allowed: true, limit: 60, remaining: 59, resetAt: Date.now() + 60_000
    });

    const req = createMockReq({ clientIdentity: undefined });
    const next = createNext();

    await applyRateLimit(req, createMockRes(), next);

    const rlReq = (checkLimitMock as jest.Mock).mock.calls[0][0] as { clientId: string };
    expect(rlReq.clientId).toBe('10.0.0.1');
  });

  it('is fail-open: attaches an allowed result and calls next() when RateLimitService throws', async () => {
    checkLimitMock.mockRejectedValueOnce(new Error('Redis connection refused'));

    const req = createMockReq();
    const next = createNext();

    await applyRateLimit(req, createMockRes(), next);

    expect(req.rateLimitResult?.allowed).toBe(true);
    expect(req.rateLimitResult?.reason).toBe('RATE_LIMIT_SERVICE_ERROR');
    // next() is still called so the request proceeds
    expect(next).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledWith();
  });
});