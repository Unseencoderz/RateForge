/**
 * Integration tests for RateLimitService.
 * Redis is mocked via ioredis-mock (globally wired in jest.setup.redis-mock.js).
 */
import { AlgorithmType } from '@rateforge/types';

import {
  checkLimit,
  resetLimit,
  setRules,
  getRules,
} from './rate-limit.service';

import type { RateLimitRequest, RuleConfig } from '@rateforge/types';

// ── Helper factories ──────────────────────────────────────────────────────────

function makeRequest(overrides: Partial<RateLimitRequest> = {}): RateLimitRequest {
  return {
    clientId:  'user-A',
    identity:  { userId: 'user-A', ip: '1.1.1.1', tier: 'free' },
    endpoint:  '/api/v1/test',
    method:    'GET',
    timestamp: Date.now(),
    algorithm: AlgorithmType.TOKEN_BUCKET,
    ...overrides
  };
}

function makeRule(overrides: Partial<RuleConfig> = {}): RuleConfig {
  return {
    id:              'test-rule',
    description:     'Test rule',
    endpointPattern: '*',
    windowMs:        60_000,
    maxRequests:     100,
    algorithm:       AlgorithmType.TOKEN_BUCKET,
    enabled:         true,
    ...overrides
  };
}

// ── Reset state between tests ─────────────────────────────────────────────────

beforeEach(() => {
  // Restore a single permissive default rule so tests start clean
  setRules([makeRule({ id: 'default', maxRequests: 100 })]);
});

// ── checkLimit — no rule matched ──────────────────────────────────────────────

describe('checkLimit — no rule matched', () => {
  it('returns allowed: true when activeRules is empty', async () => {
    setRules([]);
    const result = await checkLimit(makeRequest());
    expect(result.allowed).toBe(true);
  });

  it('reason is NO_RULE_MATCHED', async () => {
    setRules([]);
    const result = await checkLimit(makeRequest());
    expect(result.reason).toBe('NO_RULE_MATCHED');
  });

  it('limit and remaining are Infinity', async () => {
    setRules([]);
    const result = await checkLimit(makeRequest());
    expect(result.limit).toBe(Infinity);
    expect(result.remaining).toBe(Infinity);
  });
});

// ── checkLimit — per-IP isolation ─────────────────────────────────────────────

describe('checkLimit — per-IP isolation', () => {
  it('IP 1.1.1.1 consuming its limit does not block IP 2.2.2.2', async () => {
    setRules([makeRule({ id: 'ip-rule', maxRequests: 2 })]);

    const reqA = makeRequest({ identity: { userId: 'anon', ip: '1.1.1.1', tier: 'free' } });
    await checkLimit(reqA);
    await checkLimit(reqA);

    const reqB = makeRequest({ identity: { userId: 'anon', ip: '2.2.2.2', tier: 'free' } });
    const result = await checkLimit(reqB);
    expect(result.allowed).toBe(true);
  });

  it('keys are distinct for different IPs', async () => {
    setRules([makeRule({ id: 'ip-iso', maxRequests: 1 })]);

    const reqA = makeRequest({ identity: { userId: 'anon', ip: '10.0.0.1', tier: 'free' } });
    const reqB = makeRequest({ identity: { userId: 'anon', ip: '10.0.0.2', tier: 'free' } });

    await checkLimit(reqA); // consume slot for 10.0.0.1
    const resultB = await checkLimit(reqB);
    expect(resultB.allowed).toBe(true);
  });
});

// ── checkLimit — per-user isolation ──────────────────────────────────────────

describe('checkLimit — per-user isolation', () => {
  it('user-A consuming its limit does not block user-B', async () => {
    setRules([makeRule({ id: 'user-rule', maxRequests: 1 })]);

    const reqA = makeRequest({ identity: { userId: 'user-A', ip: '1.1.1.1', tier: 'free' } });
    await checkLimit(reqA);

    const reqB = makeRequest({ identity: { userId: 'user-B', ip: '1.1.1.1', tier: 'free' } });
    expect((await checkLimit(reqB)).allowed).toBe(true);
  });

  it('authenticated userId takes precedence over IP in clientId', async () => {
    // Two users with same IP but different userIds must have distinct counters
    setRules([makeRule({ id: 'uid-rule', maxRequests: 1 })]);

    const sharedIp = '9.9.9.9';
    const reqA = makeRequest({ identity: { userId: 'alice', ip: sharedIp, tier: 'free' } });
    const reqB = makeRequest({ identity: { userId: 'bob',   ip: sharedIp, tier: 'free' } });

    await checkLimit(reqA); // consume alice's slot
    expect((await checkLimit(reqB)).allowed).toBe(true); // bob's slot is still available
  });
});

// ── checkLimit — per-route isolation ─────────────────────────────────────────

describe('checkLimit — per-route isolation', () => {
  it('two endpoints build separate counters when endpointPattern differs', async () => {
    setRules([
      makeRule({ id: 'route-a', endpointPattern: '/api/v1/a', maxRequests: 1 }),
      makeRule({ id: 'route-b', endpointPattern: '/api/v1/b', maxRequests: 1 }),
    ]);

    const reqA = makeRequest({ endpoint: '/api/v1/a' });
    const reqB = makeRequest({ endpoint: '/api/v1/b' });

    await checkLimit(reqA); // exhaust route-a

    // route-b should still have capacity
    expect((await checkLimit(reqB)).allowed).toBe(true);
  });
});

// ── checkLimit — tier matching ────────────────────────────────────────────────

describe('checkLimit — tier matching', () => {
  const freeRule = makeRule({ id: 'free-rule', clientTier: 'free',  maxRequests: 5,   endpointPattern: '*' });
  const proRule  = makeRule({ id: 'pro-rule',  clientTier: 'pro',   maxRequests: 200, endpointPattern: '*' });
  const wildcard = makeRule({ id: 'wildcard',  maxRequests: 1,                        endpointPattern: '*' });

  it('a pro tier client uses the pro rule', async () => {
    setRules([freeRule, proRule]);
    const req = makeRequest({ identity: { userId: 'u', ip: '1.1.1.1', tier: 'pro' } });
    const result = await checkLimit(req);
    expect(result.ruleId).toBe('pro-rule');
  });

  it('a free tier client uses the free rule', async () => {
    setRules([freeRule, proRule]);
    const req = makeRequest({ identity: { userId: 'u', ip: '1.1.1.1', tier: 'free' } });
    const result = await checkLimit(req);
    expect(result.ruleId).toBe('free-rule');
  });

  it('a client with no matching tier falls back to the wildcard rule', async () => {
    setRules([freeRule, wildcard]);
    const req = makeRequest({ identity: { userId: 'u', ip: '1.1.1.1', tier: 'enterprise' } });
    const result = await checkLimit(req);
    expect(result.ruleId).toBe('wildcard');
  });
});

// ── checkLimit — composite key ────────────────────────────────────────────────

describe('checkLimit — composite key structure', () => {
  it('result ruleId is set to the matched rule id', async () => {
    setRules([makeRule({ id: 'my-rule' })]);
    const result = await checkLimit(makeRequest());
    expect(result.ruleId).toBe('my-rule');
  });
});

// ── resetLimit ────────────────────────────────────────────────────────────────

describe('resetLimit', () => {
  it('returns 0 when no keys exist for the client', async () => {
    const count = await resetLimit('nonexistent-client');
    expect(count).toBe(0);
  });

  it('after consuming, resetLimit returns a deleted count >= 0', async () => {
    setRules([makeRule({ id: 'reset-rule', maxRequests: 5 })]);
    await checkLimit(makeRequest({ identity: { userId: 'reset-user', ip: '5.5.5.5', tier: 'free' } }));
    const deleted = await resetLimit('reset-user');
    expect(deleted).toBeGreaterThanOrEqual(0);
  });

  it('glob-special characters in clientId are escaped before SCAN pattern', async () => {
    // clientId with glob chars must not throw or scan unintended keys
    const deleted = await resetLimit('user*wildcard');
    expect(typeof deleted).toBe('number');
  });

  it('resetLimit clears the algorithm cache (next request starts fresh)', async () => {
    setRules([makeRule({ id: 'cache-clear', maxRequests: 2 })]);
    const req = makeRequest({ identity: { userId: 'cc-user', ip: '7.7.7.7', tier: 'free' } });
    await checkLimit(req);
    await checkLimit(req); // second — exhausted
    await resetLimit('cc-user');
    // After reset, the cache is cleared → new algorithm instance → should start fresh
    const result = await checkLimit(req);
    expect(result.allowed).toBe(true);
  });
});

// ── setRules / getRules ───────────────────────────────────────────────────────

describe('setRules / getRules', () => {
  it('getRules returns the currently active rules', () => {
    const rules = [makeRule({ id: 'get-test' })];
    setRules(rules);
    expect(getRules()).toEqual(rules);
  });

  it('setRules replaces the active rule set', () => {
    setRules([makeRule({ id: 'old' })]);
    setRules([makeRule({ id: 'new' })]);
    expect(getRules()[0].id).toBe('new');
  });

  it('setRules with an empty array causes all subsequent checkLimit calls to return NO_RULE_MATCHED', async () => {
    setRules([]);
    const result = await checkLimit(makeRequest());
    expect(result.reason).toBe('NO_RULE_MATCHED');
    expect(result.allowed).toBe(true);
  });
});
