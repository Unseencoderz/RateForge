import type { RateLimitResult } from '@rateforge/types';

/**
 * Common interface for all in-memory rate-limiting algorithms.
 * Redis-backed variants extend this.
 */
export interface RateLimiterAlgorithm {
  /**
   * Check whether the given key has capacity for `cost` units.
   * Always mutates internal state (i.e. consumes tokens if allowed).
   */
  check(key: string, cost?: number): RateLimitResult | Promise<RateLimitResult>;
}
