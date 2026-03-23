import type { RateLimiterAlgorithm } from './interface';
import type { RateLimitResult } from '@rateforge/types';
import type { Redis } from 'ioredis';

/**
 * P1-M3-T3 · FixedWindowCounter — Redis backend.
 *
 * Uses INCR + EXPIRE (set-on-first-write pattern) for atomicity.
 * A Lua script ensures the counter and TTL are set in a single round-trip.
 *
 * Key pattern: caller supplies the full composite key.
 */

const FIXED_WINDOW_SCRIPT = `
local key      = KEYS[1]
local limit    = tonumber(ARGV[1])
local window_s = tonumber(ARGV[2])

local count = redis.call('INCR', key)
if count == 1 then
  redis.call('EXPIRE', key, window_s)
end
return count
`;

export class FixedWindowRedis implements RateLimiterAlgorithm {
  private readonly limit: number;
  private readonly windowMs: number;
  private readonly redis: Redis;

  constructor(redis: Redis, limit: number, windowMs: number) {
    this.redis = redis;
    this.limit = limit;
    this.windowMs = windowMs;
  }

  async check(key: string, _cost = 1): Promise<RateLimitResult> {
    void _cost;
    const windowS = Math.ceil(this.windowMs / 1_000);
    const nowMs = Date.now();
    const resetAt = nowMs + this.windowMs;

    const count = (await this.redis.eval(
      FIXED_WINDOW_SCRIPT,
      1,
      key,
      String(this.limit),
      String(windowS),
    )) as number;

    if (count <= this.limit) {
      return {
        allowed: true,
        limit: this.limit,
        remaining: Math.max(0, this.limit - count),
        resetAt,
      };
    }

    return {
      allowed: false,
      limit: this.limit,
      remaining: 0,
      resetAt,
      retryAfterMs: Math.max(0, resetAt - nowMs),
      reason: 'FIXED_WINDOW_EXCEEDED',
    };
  }
}
