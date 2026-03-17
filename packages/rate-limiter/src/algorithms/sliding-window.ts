/**
 * SlidingWindowLog — in-memory sliding window rate limiter.
 *
 * Trade-off: stores one timestamp per request within the window.
 * Memory usage is O(limit) per key in steady state, but O(traffic × windowMs)
 * under burst — do not use for very high limits or very wide windows without
 * a Redis-backed variant (P1-M4-T3).
 */
import { DEFAULT_WINDOW_MS } from '@rateforge/types';

import type { RateLimiterAlgorithm } from './interface';
import type { RateLimitResult } from '@rateforge/types';


interface SlidingWindowOptions {
  limit:    number;
  windowMs?: number;
  now?:     () => number;
}

export class SlidingWindowLog implements RateLimiterAlgorithm {
  private readonly limit:    number;
  private readonly windowMs: number;
  private readonly now:      () => number;
  // Map from key → sorted array of timestamps (oldest first)
  private readonly logs = new Map<string, number[]>();

  constructor(options: SlidingWindowOptions) {
    this.limit    = options.limit;
    this.windowMs = options.windowMs ?? DEFAULT_WINDOW_MS;
    this.now      = options.now      ?? (() => Date.now());
  }

  private _check(key: string): RateLimitResult {
    const now       = this.now();
    const threshold = now - this.windowMs;

    // Retrieve and prune timestamps older than the window
    let log = this.logs.get(key) ?? [];
    log     = log.filter(ts => ts > threshold);

    const resetAt = log.length > 0
      ? log[0] + this.windowMs   // oldest entry + windowMs = when the window will have room again
      : now + this.windowMs;

    if (log.length < this.limit) {
      log.push(now);
      this.logs.set(key, log);
      return {
        allowed:   true,
        limit:     this.limit,
        remaining: this.limit - log.length,
        resetAt
      };
    }

    return {
      allowed:      false,
      limit:        this.limit,
      remaining:    0,
      resetAt,
      retryAfterMs: Math.max(0, resetAt - now),
      reason:       'SLIDING_WINDOW_EXCEEDED'
    };
  }

  /** Satisfies RateLimiterAlgorithm. Cost is always 1 for sliding window. */
  check(key: string, _cost?: number): RateLimitResult {
    return this._check(key);
  }
}
