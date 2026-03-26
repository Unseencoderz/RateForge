/**
 * POST /api/v1/admin/rules — Supertest tests
 *
 * Strategy
 * ─────────
 * • `fs.writeFileSync`, `fs.renameSync`, and rules-store persistence are mocked
 *   so tests are hermetic — no disk I/O, no Redis connection.
 * • `getRulesPath` is mocked to return a stable fake path.
 * • Each describe group is isolated with fresh mocks via beforeEach.
 */

import fs from 'fs';

import { jest } from '@jest/globals';
import { AlgorithmType } from '@rateforge/types';
import express from 'express';
import request from 'supertest';

import type { RuleConfig } from '@rateforge/types';

// ── Prevent process.exit killing Jest ────────────────────────────────────────

jest.spyOn(process, 'exit').mockImplementation((code?: string | number | null | undefined) => {
  throw new Error(`process.exit(${code})`);
}) as unknown as jest.SpiedFunction<typeof process.exit>;

// ── Mock fs ───────────────────────────────────────────────────────────────────

jest.mock('fs');
const writeFileSyncMock = jest.spyOn(fs, 'writeFileSync').mockImplementation(() => {});
const renameSyncMock = jest.spyOn(fs, 'renameSync').mockImplementation(() => {});

const persistRulesToStoreMock = jest.fn<() => Promise<void>>().mockResolvedValue(undefined);

// ── Mock config ───────────────────────────────────────────────────────────────

jest.mock('@rateforge/config', () => ({ REDIS_URL: 'redis://localhost:6379' }));

// ── Mock rules-loader ─────────────────────────────────────────────────────────

const FAKE_RULES_PATH = '/fake/rules.json';

jest.mock('../config/rules-loader', () => ({
  getRulesPath: () => FAKE_RULES_PATH,
}));

jest.mock('../config/rules-store', () => ({
  persistRulesToStore: (...args: any[]) => (persistRulesToStoreMock as any)(...args),
}));

// ── Mock getRules (not used by POST but imported in module) ───────────────────

jest.mock('../services/rate-limiter.client', () => ({
  getRules: jest.fn().mockReturnValue([]),
}));

jest.mock('../middleware/auth', () => ({
  verifyToken: (_req: any, _res: any, next: any) => next(),
  requireAdmin: (_req: any, _res: any, next: any) => next(),
}));

// ── Import AFTER mocks ────────────────────────────────────────────────────────

import { postAdminRules, adminRouter } from './admin.controller';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const VALID_RULE: RuleConfig = {
  id: 'default',
  endpointPattern: '*',
  windowMs: 60_000,
  maxRequests: 60,
  algorithm: AlgorithmType.TOKEN_BUCKET,
  enabled: true,
};

const VALID_BODY = { rules: [VALID_RULE] };

// ── Test app factories ────────────────────────────────────────────────────────

function buildHandlerApp() {
  const app = express();
  app.use(express.json());
  app.post('/rules', postAdminRules);
  return app;
}

function buildRouterApp() {
  const app = express();
  app.use('/api/v1/admin', adminRouter);
  return app;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('POST /api/v1/admin/rules (P2-M5-T2)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'info').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
    writeFileSyncMock.mockImplementation(() => {});
    renameSyncMock.mockImplementation(() => {});
    persistRulesToStoreMock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ── Happy path ─────────────────────────────────────────────────────────────

  describe('successful rule update', () => {
    it('returns HTTP 201', async () => {
      const res = await request(buildHandlerApp()).post('/rules').send(VALID_BODY);

      expect(res.status).toBe(201);
    });

    it('returns success: true in the body', async () => {
      const res = await request(buildHandlerApp()).post('/rules').send(VALID_BODY);

      expect(res.body.success).toBe(true);
    });

    it('returns the validated rules under data', async () => {
      const res = await request(buildHandlerApp()).post('/rules').send(VALID_BODY);

      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].id).toBe('default');
    });

    it('returns all rules when multiple are provided', async () => {
      const twoRules = [VALID_RULE, { ...VALID_RULE, id: 'pro', maxRequests: 120 }];
      const res = await request(buildHandlerApp()).post('/rules').send({ rules: twoRules });

      expect(res.status).toBe(201);
      expect(res.body.data).toHaveLength(2);
    });

    it('supports "delete" semantics by replacing the full rules array (remove a rule)', async () => {
      const twoRules = [VALID_RULE, { ...VALID_RULE, id: 'to-remove', maxRequests: 5 }];

      await request(buildHandlerApp()).post('/rules').send({ rules: twoRules });
      await request(buildHandlerApp())
        .post('/rules')
        .send({ rules: [VALID_RULE] });

      const writtenSecond = JSON.parse(writeFileSyncMock.mock.calls[1]?.[1] as string);
      expect(writtenSecond).toHaveLength(1);
      expect(writtenSecond[0].id).toBe('default');
    });

    it('supports "update" semantics by replacing an existing rule with same id', async () => {
      const updated = { ...VALID_RULE, maxRequests: 999 };

      await request(buildHandlerApp()).post('/rules').send(VALID_BODY);
      await request(buildHandlerApp())
        .post('/rules')
        .send({ rules: [updated] });

      const writtenSecond = JSON.parse(writeFileSyncMock.mock.calls[1]?.[1] as string);
      expect(writtenSecond[0].id).toBe('default');
      expect(writtenSecond[0].maxRequests).toBe(999);
    });

    it('normalises method to uppercase before persisting', async () => {
      const ruleWithLower = { ...VALID_RULE, method: 'post' };
      const res = await request(buildHandlerApp())
        .post('/rules')
        .send({ rules: [ruleWithLower] });

      expect(res.status).toBe(201);
      expect(res.body.data[0].method).toBe('POST');
    });
  });

  // ── Disk write behaviour ───────────────────────────────────────────────────

  describe('atomic disk write', () => {
    it('writes to the .tmp file first', async () => {
      await request(buildHandlerApp()).post('/rules').send(VALID_BODY);

      expect(writeFileSyncMock).toHaveBeenCalledWith(
        `${FAKE_RULES_PATH}.tmp`,
        expect.any(String),
        'utf-8',
      );
    });

    it('writes valid JSON to the tmp file', async () => {
      await request(buildHandlerApp()).post('/rules').send(VALID_BODY);

      const written = writeFileSyncMock.mock.calls[0]?.[1] as string;
      expect(() => JSON.parse(written)).not.toThrow();
    });

    it('renames the .tmp file to the real rules path', async () => {
      await request(buildHandlerApp()).post('/rules').send(VALID_BODY);

      expect(renameSyncMock).toHaveBeenCalledWith(`${FAKE_RULES_PATH}.tmp`, FAKE_RULES_PATH);
    });

    it('writes before renaming (correct atomic order)', async () => {
      const callOrder: string[] = [];
      writeFileSyncMock.mockImplementation(() => {
        callOrder.push('write');
      });
      renameSyncMock.mockImplementation(() => {
        callOrder.push('rename');
      });

      await request(buildHandlerApp()).post('/rules').send(VALID_BODY);

      expect(callOrder).toEqual(['write', 'rename']);
    });

    it('persists exactly the validated rules (no extra fields)', async () => {
      await request(buildHandlerApp()).post('/rules').send(VALID_BODY);

      const written = JSON.parse(writeFileSyncMock.mock.calls[0]?.[1] as string);
      expect(Array.isArray(written)).toBe(true);
      expect(written[0].id).toBe('default');
    });
  });

  // ── Shared rules store persistence ─────────────────────────────────────────

  describe('rules store persistence', () => {
    it('persists the validated rules after writing', async () => {
      await request(buildHandlerApp()).post('/rules').send(VALID_BODY);

      expect(persistRulesToStoreMock).toHaveBeenCalledWith([VALID_RULE]);
    });

    it('persists exactly once per request', async () => {
      await request(buildHandlerApp()).post('/rules').send(VALID_BODY);

      expect(persistRulesToStoreMock).toHaveBeenCalledTimes(1);
    });

    it('persists after the file write (correct ordering)', async () => {
      const callOrder: string[] = [];
      writeFileSyncMock.mockImplementation(() => {
        callOrder.push('write');
      });
      renameSyncMock.mockImplementation(() => {
        callOrder.push('rename');
      });
      persistRulesToStoreMock.mockImplementation(async () => {
        callOrder.push('persist');
      });

      await request(buildHandlerApp()).post('/rules').send(VALID_BODY);

      expect(callOrder).toEqual(['write', 'rename', 'persist']);
    });
  });

  // ── Validation errors (400) ────────────────────────────────────────────────

  describe('request body validation', () => {
    it('returns HTTP 400 when body is missing entirely', async () => {
      const res = await request(buildHandlerApp())
        .post('/rules')
        .set('Content-Type', 'application/json')
        .send('{}');

      expect(res.status).toBe(400);
    });

    it('returns HTTP 400 when rules array is empty', async () => {
      const res = await request(buildHandlerApp()).post('/rules').send({ rules: [] });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it('returns HTTP 400 when a required field is missing (id)', async () => {
      const { id: _, ...noId } = VALID_RULE as any;
      const res = await request(buildHandlerApp())
        .post('/rules')
        .send({ rules: [noId] });

      expect(res.status).toBe(400);
    });

    it('returns HTTP 400 when windowMs is negative', async () => {
      const res = await request(buildHandlerApp())
        .post('/rules')
        .send({ rules: [{ ...VALID_RULE, windowMs: -1 }] });

      expect(res.status).toBe(400);
    });

    it('returns HTTP 400 when algorithm is not a valid enum value', async () => {
      const res = await request(buildHandlerApp())
        .post('/rules')
        .send({ rules: [{ ...VALID_RULE, algorithm: 'round_robin' }] });

      expect(res.status).toBe(400);
    });

    it('returns HTTP 400 when there is an unknown field (strict mode)', async () => {
      const res = await request(buildHandlerApp())
        .post('/rules')
        .send({ rules: [{ ...VALID_RULE, unknownField: true }] });

      expect(res.status).toBe(400);
    });

    it('returns code: INVALID_RULE_CONFIG in the error body', async () => {
      const res = await request(buildHandlerApp()).post('/rules').send({ rules: [] });

      expect(res.body.error.code).toBe('INVALID_RULE_CONFIG');
    });

    it('returns validation issue details in the error body', async () => {
      const res = await request(buildHandlerApp()).post('/rules').send({ rules: [] });

      expect(res.body.error).toBeDefined();
      expect(res.body.error.message).toBeTruthy();
    });

    it('does NOT write to disk on validation failure', async () => {
      await request(buildHandlerApp()).post('/rules').send({ rules: [] });

      expect(writeFileSyncMock).not.toHaveBeenCalled();
    });

    it('does NOT persist rules on validation failure', async () => {
      await request(buildHandlerApp()).post('/rules').send({ rules: [] });

      expect(persistRulesToStoreMock).not.toHaveBeenCalled();
    });
  });

  // ── Duplicate id guard (400) ───────────────────────────────────────────────

  describe('duplicate id validation', () => {
    it('returns HTTP 400 when two rules share the same id', async () => {
      const dupes = [VALID_RULE, { ...VALID_RULE, maxRequests: 30 }];
      const res = await request(buildHandlerApp()).post('/rules').send({ rules: dupes });

      expect(res.status).toBe(400);
    });

    it('names the conflicting ids in the error message', async () => {
      const dupes = [VALID_RULE, { ...VALID_RULE, maxRequests: 30 }];
      const res = await request(buildHandlerApp()).post('/rules').send({ rules: dupes });

      expect(res.body.error.message).toMatch(/default/);
    });

    it('does NOT write to disk when duplicate ids found', async () => {
      const dupes = [VALID_RULE, { ...VALID_RULE }];
      await request(buildHandlerApp()).post('/rules').send({ rules: dupes });

      expect(writeFileSyncMock).not.toHaveBeenCalled();
    });
  });

  // ── File system errors (500) ───────────────────────────────────────────────

  describe('file I/O errors', () => {
    it('returns HTTP 500 when writeFileSync throws', async () => {
      writeFileSyncMock.mockImplementationOnce(() => {
        throw new Error('ENOSPC: no space left on device');
      });

      const res = await request(buildHandlerApp()).post('/rules').send(VALID_BODY);

      expect(res.status).toBe(500);
      expect(res.body.error.code).toBe('INTERNAL_ERROR');
    });

    it('returns HTTP 500 when renameSync throws', async () => {
      renameSyncMock.mockImplementationOnce(() => {
        throw new Error('EACCES: permission denied');
      });

      const res = await request(buildHandlerApp()).post('/rules').send(VALID_BODY);

      expect(res.status).toBe(500);
    });

    it('does NOT persist rules when disk write fails', async () => {
      writeFileSyncMock.mockImplementationOnce(() => {
        throw new Error('disk full');
      });

      await request(buildHandlerApp()).post('/rules').send(VALID_BODY);

      expect(persistRulesToStoreMock).not.toHaveBeenCalled();
    });
  });

  // ── Shared rules store errors (500) ───────────────────────────────────────

  describe('rules store persistence errors', () => {
    it('returns HTTP 500 when persistRulesToStore() rejects', async () => {
      persistRulesToStoreMock.mockRejectedValueOnce(new Error('Redis connection refused'));

      const res = await request(buildHandlerApp()).post('/rules').send(VALID_BODY);

      expect(res.status).toBe(500);
      expect(res.body.error.code).toBe('INTERNAL_ERROR');
    });

    it('includes the Redis error in the response message', async () => {
      persistRulesToStoreMock.mockRejectedValueOnce(new Error('Redis connection refused'));

      const res = await request(buildHandlerApp()).post('/rules').send(VALID_BODY);

      expect(res.body.error.message).toMatch(/Redis connection refused/);
    });
  });

  // ── Router wiring ─────────────────────────────────────────────────────────

  describe('adminRouter wiring', () => {
    it('responds to POST /api/v1/admin/rules with HTTP 201 when mounted via adminRouter', async () => {
      const res = await request(buildRouterApp()).post('/api/v1/admin/rules').send(VALID_BODY);

      expect(res.status).toBe(201);
    });

    it('persists rules when invoked via router', async () => {
      await request(buildRouterApp()).post('/api/v1/admin/rules').send(VALID_BODY);

      expect(persistRulesToStoreMock).toHaveBeenCalledWith([VALID_RULE]);
    });
  });
});
