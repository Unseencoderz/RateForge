import { DEFAULT_WINDOW_MS, MAX_BURST } from '@rateforge/types';

import type { RateLimitResult } from '@rateforge/types';

interface BucketState {
  tokens: number;
  lastRefill: number;
}

interface TokenBucketOptions {
  /**
   * Maximum number of tokens in the bucket (the steady-state limit).
   */
  capacity: number;
  /**
   * Window size in milliseconds over which capacity tokens are refilled.
   * Defaults to DEFAULT_WINDOW_MS.
   */
  windowMs?: number;
  /**
   * Optional function to override current time (useful for tests).
   */
  now?: () => number;
}

export class TokenBucket {
  private readonly capacity: number;
  private readonly windowMs: number;
  private readonly now: () => number;
  private readonly buckets = new Map<string, BucketState>();

  constructor(options: TokenBucketOptions) {
    this.capacity = options.capacity;
    this.windowMs = options.windowMs ?? DEFAULT_WINDOW_MS;
    this.now = options.now ?? (() => Date.now());
  }

  private getBucket(key: string): BucketState {
    const existing = this.buckets.get(key);
    const now = this.now();

    if (!existing) {
      const initial: BucketState = {
        tokens: this.capacity + MAX_BURST,
        lastRefill: now
      };
      this.buckets.set(key, initial);
      return initial;
    }

    const elapsed = now - existing.lastRefill;
    if (elapsed <= 0) {
      return existing;
    }

    const refillRatePerMs = this.capacity / this.windowMs;
    const refilled = existing.tokens + elapsed * refillRatePerMs;
    existing.tokens = Math.min(refilled, this.capacity + MAX_BURST);
    existing.lastRefill = now;

    return existing;
  }

  consume(key: string, cost: number): RateLimitResult {
    const now = this.now();
    const bucket = this.getBucket(key);

    const limit = this.capacity;
    const resetAt = bucket.lastRefill + this.windowMs;

    if (bucket.tokens >= cost) {
      bucket.tokens -= cost;

      return {
        allowed: true,
        limit,
        remaining: Math.max(0, Math.floor(bucket.tokens)),
        resetAt
      };
    }

    const retryAfterMs = Math.max(0, resetAt - now);

    return {
      allowed: false,
      limit,
      remaining: Math.max(0, Math.floor(bucket.tokens)),
      resetAt,
      retryAfterMs,
      reason: 'TOKEN_BUCKET_EXHAUSTED'
    };
  }
}

