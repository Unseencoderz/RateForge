import { AlgorithmType , REDIS_KEY_PREFIX } from '@rateforge/types';

import { getAlgorithm } from '../algorithms/factory';
import { createRedisClient } from '../redis/client';

import type { RateLimiterAlgorithm } from '../algorithms/interface';
import type { RateLimitRequest, RateLimitResult, RuleConfig } from '@rateforge/types';

/**
 * Minimal in-memory rule store used until the full dynamic-rules loader
 * (P2-M4-T1) is wired in. Rules can be replaced via `setRules()`.
 */
let activeRules: RuleConfig[] = [
  {
    id: 'default',
    description: 'Default rule — 60 requests per minute per client',
    endpointPattern: '*',
    windowMs: 60_000,
    maxRequests: 60,
    algorithm: AlgorithmType.TOKEN_BUCKET,
    enabled: true
  }
];

/** Replace the active rule set (called by the rules-watcher at runtime). */
export function setRules(rules: RuleConfig[]): void {
  activeRules = rules;
}

/**
 * Return a shallow copy of the active rule set.
 *
 * Returns a copy (not a reference) so callers cannot mutate the live rule
 * store by accident — all mutations must go through `setRules()`.
 */
export function getRules(): RuleConfig[] {
  return [...activeRules];
}

/**
 * P2-M5-T3 · `resetLimit(clientId)`
 *
 * Deletes all Redis rate-limit keys associated with the given `clientId` and
 * evicts the corresponding in-memory algorithm-cache entries.
 *
 * Key pattern scanned: `{REDIS_KEY_PREFIX}:*:{clientId}:*`
 *
 * Both the `userId` dimension (authenticated clients) and the `ip` dimension
 * (anonymous clients) are stored in the same key pattern at different
 * positions, so any key containing `clientId` as a segment is included.
 *
 * Uses SCAN + DEL (not KEYS) to avoid blocking the Redis event loop on large
 * keyspaces. DEL is batched (up to 100 keys per call) to limit round-trips.
 *
 * @returns The total number of Redis keys deleted.
 */
export async function resetLimit(clientId: string): Promise<number> {
  const redis = createRedisClient();

  // Sanitise to prevent glob injection in the SCAN pattern
  const safeClient = clientId.replace(/[*?[\]]/g, '\\$&');
  const pattern    = `${REDIS_KEY_PREFIX}:*:${safeClient}:*`;

  let cursor        = '0';
  let totalDeleted  = 0;
  const BATCH_SIZE  = 100;

  do {
    const [nextCursor, keys] = await redis.scan(
      cursor,
      'MATCH', pattern,
      'COUNT', BATCH_SIZE
    );

    cursor = nextCursor;

    if (keys.length > 0) {
      // DEL accepts multiple keys in a single call — no need to pipeline here.
      const deleted = await redis.del(...keys);
      totalDeleted += deleted;
    }
  } while (cursor !== '0');

  // Evict the in-memory algorithm-cache entries for this client.
  // The cache is keyed by ruleId only, so we cannot target per-client entries
  // precisely — instead evict all rules and let them be lazily re-created.
  // This is safe because the cache contains stateless TokenBucket instances.
  algorithmCache.clear();

  console.info(
    `[rate-limit-service] resetLimit: deleted ${totalDeleted} key(s) for client "${clientId}"`
  );

  return totalDeleted;
}


/**
 * Find the most specific matching rule for a given request.
 * Specificity is determined by: endpoint pattern match → tier match → first.
 */
function matchRule(req: RateLimitRequest): RuleConfig | undefined {
  const enabled = activeRules.filter((r) => r.enabled);

  // Sort by endpointPattern length descending so specific routes ('/api/v1/a')
  // are evaluated before wildcards ('*') or shorter prefixes ('/api').
  const sorted = [...enabled].sort((a, b) => {
    if (a.endpointPattern === '*') return 1;
    if (b.endpointPattern === '*') return -1;
    return b.endpointPattern.length - a.endpointPattern.length;
  });

  // Prefer rules that match the client's tier
  const tierMatch = sorted.find(
    (r) =>
      r.clientTier === req.identity.tier &&
      (r.endpointPattern === '*' || req.endpoint.startsWith(r.endpointPattern))
  );
  if (tierMatch) return tierMatch;

  // Fall back to the first matching rule that does not require a specific tier
  return sorted.find(
    (r) =>
      !r.clientTier &&
      (r.endpointPattern === '*' || req.endpoint.startsWith(r.endpointPattern))
  );
}

/**
 * Build the composite Redis key for multi-dimensional rate limiting.
 *
 * Key pattern: `{REDIS_KEY_PREFIX}:{ruleId}:{userId}:{ip}:{endpoint}`
 *
 * ⚠️  Changing this pattern invalidates all existing Redis counters.
 *     Document any change in an ADR before modifying.
 */
function buildKey(req: RateLimitRequest, ruleId: string): string {
  const sanitised = req.endpoint.replace(/\//g, ':').replace(/^:/, '');
  return `${REDIS_KEY_PREFIX}:${ruleId}:${req.identity.userId}:${req.identity.ip}:${sanitised}`;
}

/**
 * In-memory algorithm instances keyed by ruleId, backed by AlgorithmFactory.
 */
const algorithmCache = new Map<string, RateLimiterAlgorithm>();

function getOrCreateAlgorithm(rule: RuleConfig): RateLimiterAlgorithm {
  const cached = algorithmCache.get(rule.id);
  if (cached) return cached;

  const instance = getAlgorithm(rule);
  algorithmCache.set(rule.id, instance);
  return instance;
}

/**
 * P1-M5-T2 · RateLimitService
 *
 * `checkLimit(req)` is the single entry point used by downstream middleware.
 * It:
 *   1. Selects the best matching rule for the request.
 *   2. Derives the composite Redis key (userId + ip + route).
 *   3. Delegates to the appropriate algorithm.
 *   4. Returns a `RateLimitResult` — callers must not throw on this result.
 *
 * If no rule matches, the request is allowed (fail-open by design) and
 * `ruleId` is omitted from the result.
 */
export async function checkLimit(
  req: RateLimitRequest
): Promise<RateLimitResult> {
  const rule = matchRule(req);

  if (!rule) {
    // No applicable rule → allow the request and signal the absence of a rule.
    return {
      allowed: true,
      limit: Infinity,
      remaining: Infinity,
      resetAt: req.timestamp + 60_000,
      ruleId: undefined,
      reason: 'NO_RULE_MATCHED'
    };
  }

  const key = buildKey(req, rule.id);
  const algorithm = getOrCreateAlgorithm(rule);

  // Unified interface: check() is synchronous for in-memory algorithms.
  const result = algorithm.check(key, 1);

  return {
    ...result,
    ruleId: rule.id
  };
}
