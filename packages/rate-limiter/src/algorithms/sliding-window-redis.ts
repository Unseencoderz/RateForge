import type { RateLimiterAlgorithm } from './interface';
import type { RateLimitResult } from '@rateforge/types';
import type { Redis } from 'ioredis';

/**
 * P1-M4-T3 · SlidingWindowLog — Redis backend.
 *
 * Uses ZADD + ZREMRANGEBYSCORE + ZCARD in a Lua script for atomicity.
 * Each request is stored as a scored set member (score = timestamp ms).
 * Old entries are pruned before counting.
 *
 * Trade-off: O(limit) memory per key. Document in ADR if limit > 1000.
 */

const SLIDING_WINDOW_SCRIPT = `
local key        = KEYS[1]
local limit      = tonumber(ARGV[1])
local now_ms     = tonumber(ARGV[2])
local window_ms  = tonumber(ARGV[3])
local threshold  = now_ms - window_ms

-- Remove timestamps outside the window
redis.call('ZREMRANGEBYSCORE', key, '-inf', threshold)

-- Count remaining entries
local count = redis.call('ZCARD', key)

if count < limit then
  -- Add this request (unique member = now_ms + random suffix)
  local member = tostring(now_ms) .. ':' .. tostring(math.random(1, 999999))
  redis.call('ZADD', key, now_ms, member)
  redis.call('PEXPIRE', key, window_ms)

  local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
  local reset_at = now_ms + window_ms
  if #oldest >= 2 then
    reset_at = tonumber(oldest[2]) + window_ms
  end

  return { 1, limit - count - 1, reset_at }
end

-- Blocked — find when the oldest entry expires
local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
local reset_at = now_ms + window_ms
if #oldest >= 2 then
  reset_at = tonumber(oldest[2]) + window_ms
end

return { 0, 0, reset_at }
`;

export class SlidingWindowRedis implements RateLimiterAlgorithm {
  private readonly limit: number;
  private readonly windowMs: number;
  private readonly redis: Redis;

  constructor(redis: Redis, limit: number, windowMs: number) {
    this.redis    = redis;
    this.limit    = limit;
    this.windowMs = windowMs;
  }

  async checkAsync(key: string, _cost = 1): Promise<RateLimitResult> {
  void _cost;
    const nowMs = Date.now();

    const raw = await this.redis.eval(
      SLIDING_WINDOW_SCRIPT,
      1,
      key,
      String(this.limit),
      String(nowMs),
      String(this.windowMs)
    ) as [number, number, number];

    const [allowedRaw, remaining, resetAt] = raw;
    const allowed = allowedRaw === 1;

    return {
      allowed,
      limit:        this.limit,
      remaining:    Math.max(0, remaining),
      resetAt,
      retryAfterMs: allowed ? undefined : Math.max(0, resetAt - nowMs),
      reason:       allowed ? undefined : 'SLIDING_WINDOW_EXCEEDED',
    };
  }

  /** Synchronous stub — satisfies interface. Callers must use checkAsync(). */
  check(key: string, cost = 1): RateLimitResult {
    void key; void cost;
    return {
      allowed:   true,
      limit:     this.limit,
      remaining: this.limit,
      resetAt:   Date.now() + this.windowMs,
      reason:    'REDIS_ASYNC_REQUIRED',
    };
  }
}   