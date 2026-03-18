import { AlgorithmType } from '@rateforge/types';

import { FixedWindowCounter }  from './fixed-window';
import { SlidingWindowLog }    from './sliding-window';
import { TokenBucket }         from './token-bucket';

import type { RateLimiterAlgorithm } from './interface';
import type { RuleConfig }           from '@rateforge/types';

/**
 * P1-M5-T1 · AlgorithmFactory
 *
 * Returns a new algorithm instance configured from the given rule.
 * Services must never import algorithm classes directly — always go through this factory.
 *
 * Leaky bucket is not yet implemented; rules with algorithm: 'leaky_bucket'
 * log a warning and fall back to token bucket.
 */
export function getAlgorithm(rule: RuleConfig): RateLimiterAlgorithm {
  switch (rule.algorithm) {
    case AlgorithmType.TOKEN_BUCKET:
      return new TokenBucket({
        capacity:      rule.maxRequests,
        windowMs:      rule.windowMs,
        burstCapacity: rule.burstCapacity
      });

    case AlgorithmType.FIXED_WINDOW:
      return new FixedWindowCounter({
        limit:    rule.maxRequests,
        windowMs: rule.windowMs
      });

    case AlgorithmType.SLIDING_WINDOW:
      return new SlidingWindowLog({
        limit:    rule.maxRequests,
        windowMs: rule.windowMs
      });

    case AlgorithmType.LEAKY_BUCKET:
      console.warn(
        `[algorithm-factory] leaky_bucket is not yet implemented for rule "${rule.id}". ` +
        `Falling back to token_bucket.`
      );
      return new TokenBucket({
        capacity: rule.maxRequests,
        windowMs: rule.windowMs
      });

    default: {
      // TypeScript exhaustiveness guard
      const exhaustive: never = rule.algorithm as never;
      throw new Error(`[algorithm-factory] Unknown algorithm type: "${String(exhaustive)}"`);
    }
  }
}
