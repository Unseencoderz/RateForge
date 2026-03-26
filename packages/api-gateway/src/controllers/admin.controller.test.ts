/**
 * Admin controller — unit + Supertest tests
 *
 * Strategy
 * ─────────
 * • `getRules` (RateLimitService) is mocked so tests never need Redis or a
 *   real rule file — full isolation, no side-effects.
 * • A real Express app is built per describe group so each suite is
 *   independent and route state cannot bleed between tests.
 * • Both the thin handler (`getAdminRules`) and the full router
 *   (`adminRouter`) wiring are exercised.
 */

import { jest } from '@jest/globals';
import { AlgorithmType } from '@rateforge/types';
import express from 'express';
import request from 'supertest';

import type { RuleConfig } from '@rateforge/types';

// ── Mock RateLimitService ─────────────────────────────────────────────────────

const getRulesMock = jest.fn<() => RuleConfig[]>();

jest.mock('../services/rate-limiter.client', () => ({
  getRules: () => getRulesMock(),
}));

jest.mock('@rateforge/config', () => ({
  REDIS_URL: 'redis://localhost:6379',
  JWT_SECRET: 'test-secret',
  NODE_ENV: 'test',
  PORT: 8080,
  LOG_LEVEL: 'info',
}));

jest.mock('../middleware/auth', () => ({
  verifyToken: (_req: any, _res: any, next: any) => next(),
  requireAdmin: (_req: any, _res: any, next: any) => next(),
}));

// ── Import AFTER mocks ────────────────────────────────────────────────────────

import { getAdminRules, adminRouter } from './admin.controller';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const RULE_A: RuleConfig = {
  id: 'free-tier',
  description: 'Free tier global limit',
  clientTier: 'free',
  endpointPattern: '*',
  windowMs: 60_000,
  maxRequests: 30,
  algorithm: AlgorithmType.TOKEN_BUCKET,
  enabled: true,
};

const RULE_B: RuleConfig = {
  id: 'pro-tier',
  endpointPattern: '*',
  windowMs: 60_000,
  maxRequests: 120,
  algorithm: AlgorithmType.SLIDING_WINDOW,
  enabled: true,
};

// ── Build minimal Express apps ────────────────────────────────────────────────

function buildHandlerApp() {
  const app = express();
  app.get('/rules', getAdminRules);
  return app;
}

function buildRouterApp() {
  const app = express();
  app.use('/api/v1/admin', adminRouter);
  return app;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('GET /api/v1/admin/rules — admin controller (P2-M5-T1)', () => {
  beforeEach(() => {
    getRulesMock.mockReset();
  });

  // ── Response shape ─────────────────────────────────────────────────────────

  describe('successful response', () => {
    it('returns HTTP 200', async () => {
      getRulesMock.mockReturnValueOnce([RULE_A]);

      const res = await request(buildHandlerApp()).get('/rules');

      expect(res.status).toBe(200);
    });

    it('returns success: true in the response body', async () => {
      getRulesMock.mockReturnValueOnce([RULE_A]);

      const res = await request(buildHandlerApp()).get('/rules');

      expect(res.body.success).toBe(true);
    });

    it('returns the current rules array under data', async () => {
      getRulesMock.mockReturnValueOnce([RULE_A, RULE_B]);

      const res = await request(buildHandlerApp()).get('/rules');

      expect(res.body.data).toHaveLength(2);
      expect(res.body.data[0].id).toBe('free-tier');
      expect(res.body.data[1].id).toBe('pro-tier');
    });

    it('returns an empty array when no rules are active', async () => {
      getRulesMock.mockReturnValueOnce([]);

      const res = await request(buildHandlerApp()).get('/rules');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toEqual([]);
    });

    it('returns all fields of each RuleConfig without stripping', async () => {
      getRulesMock.mockReturnValueOnce([RULE_A]);

      const res = await request(buildHandlerApp()).get('/rules');

      const rule = res.body.data[0];
      expect(rule.id).toBe(RULE_A.id);
      expect(rule.description).toBe(RULE_A.description);
      expect(rule.clientTier).toBe(RULE_A.clientTier);
      expect(rule.endpointPattern).toBe(RULE_A.endpointPattern);
      expect(rule.windowMs).toBe(RULE_A.windowMs);
      expect(rule.maxRequests).toBe(RULE_A.maxRequests);
      expect(rule.algorithm).toBe(RULE_A.algorithm);
      expect(rule.enabled).toBe(RULE_A.enabled);
    });

    it('returns Content-Type: application/json', async () => {
      getRulesMock.mockReturnValueOnce([RULE_A]);

      const res = await request(buildHandlerApp()).get('/rules');

      expect(res.headers['content-type']).toMatch(/application\/json/);
    });
  });

  // ── Data integrity ─────────────────────────────────────────────────────────

  describe('data integrity', () => {
    it('reflects the rules currently held by RateLimitService (not stale disk state)', async () => {
      // Simulate a hot-reload that changed the rule set after startup
      const hotReloaded: RuleConfig = { ...RULE_A, maxRequests: 999, id: 'hot-reloaded' };
      getRulesMock.mockReturnValueOnce([hotReloaded]);

      const res = await request(buildHandlerApp()).get('/rules');

      expect(res.body.data[0].maxRequests).toBe(999);
      expect(res.body.data[0].id).toBe('hot-reloaded');
    });

    it('calls getRules() exactly once per request', async () => {
      getRulesMock.mockReturnValue([RULE_A]);

      await request(buildHandlerApp()).get('/rules');

      expect(getRulesMock).toHaveBeenCalledTimes(1);
    });
  });

  // ── Error handling ─────────────────────────────────────────────────────────

  describe('error handling', () => {
    it('returns HTTP 500 when getRules() throws', async () => {
      getRulesMock.mockImplementationOnce(() => {
        throw new Error('Service unavailable');
      });

      const res = await request(buildHandlerApp()).get('/rules');

      expect(res.status).toBe(500);
    });

    it('returns success: false on error', async () => {
      getRulesMock.mockImplementationOnce(() => {
        throw new Error('oops');
      });

      const res = await request(buildHandlerApp()).get('/rules');

      expect(res.body.success).toBe(false);
    });

    it('returns code: INTERNAL_ERROR in the error body', async () => {
      getRulesMock.mockImplementationOnce(() => {
        throw new Error('oops');
      });

      const res = await request(buildHandlerApp()).get('/rules');

      expect(res.body.error.code).toBe('INTERNAL_ERROR');
    });

    it('includes the error message in the response body', async () => {
      getRulesMock.mockImplementationOnce(() => {
        throw new Error('Redis is down');
      });

      const res = await request(buildHandlerApp()).get('/rules');

      expect(res.body.error.message).toMatch(/Redis is down/);
    });
  });

  // ── Router wiring ─────────────────────────────────────────────────────────

  describe('adminRouter wiring', () => {
    it('responds to GET /api/v1/admin/rules with HTTP 200 when mounted via adminRouter', async () => {
      getRulesMock.mockReturnValueOnce([RULE_A]);

      const res = await request(buildRouterApp()).get('/api/v1/admin/rules');

      expect(res.status).toBe(200);
    });

    it('returns the correct rule data when mounted via adminRouter', async () => {
      getRulesMock.mockReturnValueOnce([RULE_B]);

      const res = await request(buildRouterApp()).get('/api/v1/admin/rules');

      expect(res.body.data[0].id).toBe('pro-tier');
    });

    it('returns 404 for any route other than GET /rules on the admin router', async () => {
      const res = await request(buildRouterApp()).get('/api/v1/admin/unknown');

      expect(res.status).toBe(404);
    });
  });
});
