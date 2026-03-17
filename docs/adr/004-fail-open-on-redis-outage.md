# ADR 004: Fail-open when Redis is unreachable

## Context

RateForge uses Redis as the shared state store for rate-limit counters.
If Redis becomes unreachable (network partition, restart, OOM), the
rate-limiter service cannot evaluate limits.

Two strategies exist:
- **Fail-closed**: reject all requests when Redis is down → zero risk of abuse but causes an outage.
- **Fail-open**: allow all requests when Redis is down → no service outage but limits are bypassed.

## Decision

RateForge fails **open**. When the rate-limiter service throws or is unreachable,
the api-gateway middleware returns `{ allowed: true, reason: 'RATE_LIMIT_SERVICE_ERROR' }`
and the request proceeds.

This is implemented in two layers:
1. `packages/api-gateway/src/middleware/rate-limit.ts` — try/catch around `checkLimit()`.
2. `packages/api-gateway/src/services/rate-limiter.client.ts` — HTTP failure returns a permissive result.

## Consequences

- **Positive**: A Redis outage does not cause a full service outage for end-users.
- **Negative**: During a Redis outage, rate limits are not enforced. A sophisticated attacker
  could deliberately trigger a Redis outage to bypass limits.
- **Mitigation**: Monitor Redis availability via the `/ready` probe. Alert immediately on
  Redis disconnection. Consider fail-closed for security-critical endpoints via a per-rule config flag (future work).

4
