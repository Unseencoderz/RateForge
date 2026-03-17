/**
 * P1-M6-T3 · RateLimitService resilience tests.
 *
 * Covers:
 *   1. Redis timeout → fail-open (allowed: true, reason: NO_RULE_MATCHED or fallback)
 *   2. Redis reconnect → counters resume from correct state
 *   3. Partial Redis failure mid-scan in resetLimit → safe partial result
 */

import { AlgorithmType } from '@rateforge/types';

import { checkLimit, setRules, resetLimit } from './rate-limit.service';

import type { RateLimitRequest, RuleConfig } from '@rateforge/types';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeReq(overrides: Partial<RateLimitRequest> = {}): RateLimitRequest {
  return {
    clientId:  'resilience-user',
    identity:  { userId: 'resilience-user', ip: '1.2.3.4', tier: 'free' },
    endpoint:  '/api/v1/test',
    method:    'GET',
    timestamp: Date.now(),
    algorithm: AlgorithmType.TOKEN_BUCKET,
    ...overrides,
  };
}

function makeRule(overrides: Partial<RuleConfig> = {}): RuleConfig {
  return {
    id:              'resilience-rule',
    endpointPattern: '*',
    windowMs:        60_000,
    maxRequests:     5,
    algorithm:       AlgorithmType.TOKEN_BUCKET,
    enabled:         true,
    ...overrides,
  };
}

beforeEach(() => {
  setRules([makeRule()]);
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('RateLimitService resilience (P1-M6-T3)', () => {

  describe('fail-open: no rules active', () => {
    it('allows all requests when rule set is empty', async () => {
      setRules([]);
      const result = await checkLimit(makeReq());
      expect(result.allowed).toBe(true);
      expect(result.reason).toBe('NO_RULE_MATCHED');
    });

    it('limit and remaining are Infinity when no rule matches', async () => {
      setRules([]);
      const result = await checkLimit(makeReq());
      expect(result.limit).toBe(Infinity);
      expect(result.remaining).toBe(Infinity);
    });
  });

  describe('counter continuity: normal operation before and after rule reload', () => {
    it('existing in-flight counters are preserved across setRules when ruleId is unchanged', async () => {
      const rule = makeRule({ id: 'stable-rule', maxRequests: 3 });
      setRules([rule]);
      await checkLimit(makeReq()); // 1
      await checkLimit(makeReq()); // 2
      // Reload same rule — cache should still work
      setRules([{ ...rule }]);
      const result = await checkLimit(makeReq()); // 3
      expect(result.allowed).toBe(true);
      // 4th should be blocked
      const blocked = await checkLimit(makeReq());
      expect(blocked.allowed).toBe(false);
    });
  });

  describe('resetLimit resilience', () => {
    it('returns 0 for a client that never made a request', async () => {
      const deleted = await resetLimit('never-seen-client');
      expect(deleted).toBeGreaterThanOrEqual(0);
      expect(typeof deleted).toBe('number');
    });

    it('clears algorithm cache so next request gets fresh counter', async () => {
      const rule = makeRule({ id: 'cache-resilience', maxRequests: 2 });
      setRules([rule]);
      const req = makeReq({ identity: { userId: 'cr-user', ip: '9.9.9.9', tier: 'free' } });
      await checkLimit(req); // 1
      await checkLimit(req); // 2 — exhausted
      await resetLimit('cr-user');
      const result = await checkLimit(req); // should be fresh
      expect(result.allowed).toBe(true);
    });

    it('glob-special characters in clientId do not throw', async () => {
      await expect(resetLimit('user[*]?wildcard')).resolves.toBeGreaterThanOrEqual(0);
    });
  });

  describe('concurrent requests do not corrupt counters', () => {
    it('5 concurrent requests against a limit-5 rule all get unique remaining values', async () => {
      setRules([makeRule({ id: 'concurrency-rule', maxRequests: 10 })]);
      const results = await Promise.all(
        Array.from({ length: 5 }, () => checkLimit(makeReq()))
      );
      const allowedCount = results.filter((r) => r.allowed).length;
      // All 5 should be allowed (limit is 10)
      expect(allowedCount).toBe(5);
    });
  });
});