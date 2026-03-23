import { executeTokenBucket } from '../redis/scripts';

import type { RateLimiterAlgorithm } from './interface';
import type { RateLimitResult } from '@rateforge/types';
import type { Redis } from 'ioredis';

export class TokenBucketRedis implements RateLimiterAlgorithm {
  private readonly capacity: number;
  private readonly windowMs: number;
  private readonly redis: Redis;
  private readonly burstCapacity?: number;

  constructor(redis: Redis, capacity: number, windowMs: number, burstCapacity?: number) {
    this.redis = redis;
    this.capacity = capacity;
    this.windowMs = windowMs;
    this.burstCapacity = burstCapacity;
  }

  async check(key: string, cost = 1): Promise<RateLimitResult> {
    const effectiveCapacity = this.burstCapacity ?? this.capacity;
    const nowMs = Date.now();
    const refillRatePerMs = this.capacity / this.windowMs;

    const result = await executeTokenBucket(
      this.redis,
      key,
      effectiveCapacity,
      refillRatePerMs,
      cost,
      nowMs,
      this.windowMs,
    );

    return {
      allowed: result.allowed,
      limit: this.capacity,
      remaining: result.remaining,
      resetAt: result.resetAt,
      retryAfterMs: result.allowed ? undefined : Math.max(0, result.resetAt - nowMs),
      reason: result.allowed ? undefined : 'TOKEN_BUCKET_EXHAUSTED',
    };
  }
}
