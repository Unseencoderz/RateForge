import { AlgorithmType } from '@rateforge/types';

import { logger } from '../utils/logger';

import { FixedWindowCounter } from './fixed-window';
import { FixedWindowRedis } from './fixed-window-redis';
import { SlidingWindowLog } from './sliding-window';
import { SlidingWindowRedis } from './sliding-window-redis';
import { TokenBucket } from './token-bucket';
import { TokenBucketRedis } from './token-bucket-redis';

import type { RateLimiterAlgorithm } from './interface';
import type { RuleConfig } from '@rateforge/types';
import type { Redis } from 'ioredis';

/**
 * AlgorithmFactory
 *
 * Returns a new algorithm instance configured from the given rule.
 * Services must never import algorithm classes directly — always go through this factory.
 *
 * Leaky bucket is not yet implemented; rules with algorithm: 'leaky_bucket'
 * log a warning and fall back to token bucket.
 */
export function getAlgorithm(rule: RuleConfig, redis?: Redis): RateLimiterAlgorithm {
  switch (rule.algorithm) {
    case AlgorithmType.TOKEN_BUCKET:
      if (redis) {
        return new TokenBucketRedis(redis, rule.maxRequests, rule.windowMs, rule.burstCapacity);
      }
      return new TokenBucket({
        capacity: rule.maxRequests,
        windowMs: rule.windowMs,
        burstCapacity: rule.burstCapacity,
      });

    case AlgorithmType.FIXED_WINDOW:
      if (redis) {
        return new FixedWindowRedis(redis, rule.maxRequests, rule.windowMs);
      }
      return new FixedWindowCounter({
        limit: rule.maxRequests,
        windowMs: rule.windowMs,
      });

    case AlgorithmType.SLIDING_WINDOW:
      if (redis) {
        return new SlidingWindowRedis(redis, rule.maxRequests, rule.windowMs);
      }
      return new SlidingWindowLog({
        limit: rule.maxRequests,
        windowMs: rule.windowMs,
      });

    case AlgorithmType.LEAKY_BUCKET:
      logger.warn({
        message: 'Leaky bucket is not implemented; falling back to token bucket',
        event: 'algorithm_factory.fallback',
        ruleId: rule.id,
        requestedAlgorithm: rule.algorithm,
        fallbackAlgorithm: AlgorithmType.TOKEN_BUCKET,
      });
      if (redis) {
        return new TokenBucketRedis(redis, rule.maxRequests, rule.windowMs, rule.burstCapacity);
      }
      return new TokenBucket({
        capacity: rule.maxRequests,
        windowMs: rule.windowMs,
      });

    default: {
      // TypeScript exhaustiveness guard
      const exhaustive: never = rule.algorithm as never;
      throw new Error(`[algorithm-factory] Unknown algorithm type: "${String(exhaustive)}"`);
    }
  }
}
