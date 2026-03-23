import { REDIS_URL } from '@rateforge/config';
import { AlgorithmType, RULES_STORE_KEY, RULES_UPDATE_CHANNEL } from '@rateforge/types';
import IORedis from 'ioredis';
import { z } from 'zod';

import { markRedisError, markRedisHealthy } from '../metrics/registry';
import { createRedisClient } from '../redis/client';
import { setRules } from '../services/rate-limit.service';
import { getErrorMeta, logger } from '../utils/logger';

import type { RuleConfig } from '@rateforge/types';

const RuleConfigSchema = z
  .object({
    id: z.string().min(1),
    description: z.string().optional(),
    clientTier: z.string().optional(),
    endpointPattern: z.string().min(1),
    method: z.string().optional(),
    windowMs: z.number().int().positive(),
    maxRequests: z.number().int().positive(),
    burstCapacity: z.number().int().nonnegative().optional(),
    algorithm: z.nativeEnum(AlgorithmType),
    enabled: z.boolean(),
  })
  .strict();

const RulesStoreSchema = z.array(RuleConfigSchema);

function parseStoredRules(raw: string): RuleConfig[] {
  const parsed = JSON.parse(raw) as unknown;
  return RulesStoreSchema.parse(parsed);
}

export async function loadRulesFromStore(): Promise<RuleConfig[] | null> {
  try {
    const raw = await createRedisClient().get(RULES_STORE_KEY);
    markRedisHealthy('rules_store_load');

    if (!raw) {
      return null;
    }

    return parseStoredRules(raw);
  } catch (err) {
    markRedisError('rules_store_load');
    throw err;
  }
}

export async function initialiseRulesFromStore(): Promise<void> {
  try {
    const rules = await loadRulesFromStore();
    if (!rules) {
      logger.warn({
        message: 'No shared rules found in Redis; using in-process defaults',
        event: 'rules_store.empty',
      });
      return;
    }

    setRules(rules);
    logger.info({
      message: 'Shared rules loaded from Redis store',
      event: 'rules_store.loaded',
      ruleCount: rules.length,
    });
  } catch (err) {
    logger.error({
      message: 'Failed to load shared rules from Redis store',
      event: 'rules_store.load_failed',
      ...getErrorMeta(err),
    });
  }
}

export interface RulesSubscriberHandle {
  stop: () => Promise<void>;
}

export function startRulesSubscriber(): RulesSubscriberHandle {
  const subscriber = new IORedis(REDIS_URL, {
    maxRetriesPerRequest: null,
    retryStrategy(times: number) {
      return Math.min(times * 300, 10_000);
    },
  });

  subscriber.subscribe(RULES_UPDATE_CHANNEL, (err) => {
    if (err) {
      markRedisError('rules_subscriber');
      logger.error({
        message: 'Failed to subscribe for rule updates',
        event: 'rules_subscriber.subscribe_failed',
        ...getErrorMeta(err),
      });
      return;
    }

    markRedisHealthy('rules_subscriber');
    logger.info({
      message: 'Subscribed to shared rules update channel',
      event: 'rules_subscriber.subscribed',
      channel: RULES_UPDATE_CHANNEL,
    });
  });

  subscriber.on('message', async (channel) => {
    if (channel !== RULES_UPDATE_CHANNEL) {
      return;
    }

    try {
      const rules = await loadRulesFromStore();
      if (!rules) {
        logger.warn({
          message: 'Rule update received but Redis store was empty',
          event: 'rules_subscriber.empty_update',
          channel,
        });
        return;
      }

      setRules(rules);
      logger.info({
        message: 'Applied rules from shared Redis store',
        event: 'rules_subscriber.applied',
        channel,
        ruleCount: rules.length,
      });
    } catch (err) {
      markRedisError('rules_subscriber');
      logger.error({
        message: 'Failed to apply shared rule update',
        event: 'rules_subscriber.apply_failed',
        channel,
        ...getErrorMeta(err),
      });
    }
  });

  subscriber.on('error', (err: Error) => {
    markRedisError('rules_subscriber');
    logger.error({
      message: 'Rules subscriber connection error',
      event: 'rules_subscriber.connection_error',
      ...getErrorMeta(err),
    });
  });

  return {
    stop: async () => {
      await subscriber.unsubscribe(RULES_UPDATE_CHANNEL);
      subscriber.disconnect();
    },
  };
}
