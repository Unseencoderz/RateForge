import { DEFAULT_WINDOW_MS } from '@rateforge/types';

import type { RateLimiterAlgorithm } from './interface';
import type { RateLimitResult } from '@rateforge/types';


interface WindowState {
  count:       number;
  windowStart: number;
}

interface FixedWindowOptions {
  limit:    number;
  windowMs?: number;
  now?:     () => number;
}

export class FixedWindowCounter implements RateLimiterAlgorithm {
  private readonly limit:    number;
  private readonly windowMs: number;
  private readonly now:      () => number;
  private readonly windows = new Map<string, WindowState>();

  constructor(options: FixedWindowOptions) {
    this.limit    = options.limit;
    this.windowMs = options.windowMs ?? DEFAULT_WINDOW_MS;
    this.now      = options.now      ?? (() => Date.now());
  }

  private _check(key: string): RateLimitResult {
    const now    = this.now();
    let   window = this.windows.get(key);

    // Start a new window if none exists or current window has expired
    if (!window || now >= window.windowStart + this.windowMs) {
      window = { count: 0, windowStart: now };
      this.windows.set(key, window);
    }

    const resetAt = window.windowStart + this.windowMs;

    if (window.count < this.limit) {
      window.count++;
      return {
        allowed:   true,
        limit:     this.limit,
        remaining: this.limit - window.count,
        resetAt
      };
    }

    return {
      allowed:      false,
      limit:        this.limit,
      remaining:    0,
      resetAt,
      retryAfterMs: Math.max(0, resetAt - now),
      reason:       'FIXED_WINDOW_EXCEEDED'
    };
  }

  /** Satisfies RateLimiterAlgorithm. Cost is always 1 for fixed window. */
  check(key: string, _cost?: number): RateLimitResult {
    return this._check(key);
  }
}
