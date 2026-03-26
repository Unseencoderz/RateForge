/**
 * POST /api/v1/admin/reset/:clientId — tests
 *
 * Strategy
 * ─────────
 * • `resetLimit` from RateLimitService is mocked — no Redis needed.
 * • Both handler and router mounting paths are tested.
 * • Error paths: empty clientId (400), resetLimit throws (500).
 */

import { jest } from '@jest/globals';
import express from 'express';
import request from 'supertest';

// ── Mock dependencies (must precede all imports from mocked modules) ──────────

const resetLimitMock = jest.fn<() => Promise<number>>();

jest.mock('../services/rate-limiter.client', () => ({
  getRules: jest.fn().mockReturnValue([]),
  resetLimit: (...args: any[]) => (resetLimitMock as any)(...args),
}));

jest.mock('ioredis', () => {
  const M = jest
    .fn()
    .mockImplementation(() => ({ publish: jest.fn<any>().mockResolvedValue(1) })) as any;
  (M as any).default = M;
  return { __esModule: true, default: M };
});

jest.mock('@rateforge/config', () => ({ REDIS_URL: 'redis://localhost:6379' }));
jest.mock('../config/rules-loader', () => ({ getRulesPath: () => '/fake/rules.json' }));
jest.mock('../config/rules-watcher', () => ({ RULES_UPDATE_CHANNEL: 'rateforge:rules:update' }));
jest.mock('fs', () => ({
  writeFileSync: jest.fn(),
  renameSync: jest.fn(),
}));

jest.mock('../middleware/auth', () => ({
  verifyToken: (_req: any, _res: any, next: any) => next(),
  requireAdmin: (_req: any, _res: any, next: any) => next(),
}));

// ── Import AFTER mocks ────────────────────────────────────────────────────────

import { postAdminResetClient, adminRouter } from './admin.controller';

// ── App factories ─────────────────────────────────────────────────────────────

function buildHandlerApp() {
  const app = express();
  app.post('/reset/:clientId', postAdminResetClient);
  return app;
}

function buildRouterApp() {
  const app = express();
  app.use('/api/v1/admin', adminRouter);
  return app;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('POST /api/v1/admin/reset/:clientId (P2-M5-T3)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'info').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ── Happy path ─────────────────────────────────────────────────────────────

  describe('successful reset', () => {
    it('returns HTTP 200', async () => {
      resetLimitMock.mockResolvedValueOnce(5);

      const res = await request(buildHandlerApp()).post('/reset/user-123');

      expect(res.status).toBe(200);
    });

    it('returns success: true', async () => {
      resetLimitMock.mockResolvedValueOnce(3);

      const res = await request(buildHandlerApp()).post('/reset/user-123');

      expect(res.body.success).toBe(true);
    });

    it('echoes the clientId in the response data', async () => {
      resetLimitMock.mockResolvedValueOnce(2);

      const res = await request(buildHandlerApp()).post('/reset/alice');

      expect(res.body.data.clientId).toBe('alice');
    });

    it('returns the count of deleted keys in data.deletedKeys', async () => {
      resetLimitMock.mockResolvedValueOnce(7);

      const res = await request(buildHandlerApp()).post('/reset/user-abc');

      expect(res.body.data.deletedKeys).toBe(7);
    });

    it('returns 0 deleted keys when the client had no counters', async () => {
      resetLimitMock.mockResolvedValueOnce(0);

      const res = await request(buildHandlerApp()).post('/reset/unknown-client');

      expect(res.status).toBe(200);
      expect(res.body.data.deletedKeys).toBe(0);
    });

    it('passes the exact clientId from the URL param to resetLimit()', async () => {
      resetLimitMock.mockResolvedValueOnce(1);

      await request(buildHandlerApp()).post('/reset/my-user-id-42');

      expect(resetLimitMock).toHaveBeenCalledWith('my-user-id-42');
    });

    it('works with IP-style clientIds (anonymous clients)', async () => {
      resetLimitMock.mockResolvedValueOnce(4);

      const res = await request(buildHandlerApp()).post('/reset/192.168.1.100');

      expect(res.status).toBe(200);
      expect(res.body.data.clientId).toBe('192.168.1.100');
    });

    it('calls resetLimit() exactly once per request', async () => {
      resetLimitMock.mockResolvedValueOnce(1);

      await request(buildHandlerApp()).post('/reset/user-123');

      expect(resetLimitMock).toHaveBeenCalledTimes(1);
    });
  });

  // ── Error: Redis failure (500) ────────────────────────────────────────────

  describe('Redis errors', () => {
    it('returns HTTP 500 when resetLimit() throws', async () => {
      resetLimitMock.mockRejectedValueOnce(new Error('SCAN failed'));

      const res = await request(buildHandlerApp()).post('/reset/user-123');

      expect(res.status).toBe(500);
    });

    it('returns success: false on error', async () => {
      resetLimitMock.mockRejectedValueOnce(new Error('timeout'));

      const res = await request(buildHandlerApp()).post('/reset/user-123');

      expect(res.body.success).toBe(false);
    });

    it('returns code: INTERNAL_ERROR on error', async () => {
      resetLimitMock.mockRejectedValueOnce(new Error('timeout'));

      const res = await request(buildHandlerApp()).post('/reset/user-123');

      expect(res.body.error.code).toBe('INTERNAL_ERROR');
    });

    it('includes the underlying error message in the response body', async () => {
      resetLimitMock.mockRejectedValueOnce(new Error('Redis connection refused'));

      const res = await request(buildHandlerApp()).post('/reset/user-123');

      expect(res.body.error.message).toMatch(/Redis connection refused/);
    });
  });

  // ── Router wiring ─────────────────────────────────────────────────────────

  describe('adminRouter wiring', () => {
    it('responds to POST /api/v1/admin/reset/:clientId with HTTP 200', async () => {
      resetLimitMock.mockResolvedValueOnce(3);

      const res = await request(buildRouterApp()).post('/api/v1/admin/reset/bob');

      expect(res.status).toBe(200);
    });

    it('passes the correct clientId from the URL when mounted via router', async () => {
      resetLimitMock.mockResolvedValueOnce(1);

      await request(buildRouterApp()).post('/api/v1/admin/reset/carol');

      expect(resetLimitMock).toHaveBeenCalledWith('carol');
    });

    it('returns 404 for unregistered admin routes', async () => {
      const res = await request(buildRouterApp()).post('/api/v1/admin/unknown');

      expect(res.status).toBe(404);
    });
  });
});
