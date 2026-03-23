import { REDIS_URL } from '@rateforge/config';
import { AlgorithmType, RULES_STORE_KEY, RULES_UPDATE_CHANNEL } from '@rateforge/types';
import IORedis from 'ioredis';
import { z } from 'zod';

import { createRedisClient } from '../redis/client';
import { setRules } from '../services/rate-limit.service';

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
  const raw = await createRedisClient().get(RULES_STORE_KEY);
  if (!raw) {
    return null;
  }

  return parseStoredRules(raw);
}

export async function initialiseRulesFromStore(): Promise<void> {
  try {
    const rules = await loadRulesFromStore();
    if (!rules) {
      console.warn('[rate-limiter] No shared rules found in Redis; using in-process defaults');
      return;
    }

    setRules(rules);
    console.info(`[rate-limiter] Loaded ${rules.length} rule(s) from the shared Redis store`);
  } catch (err) {
    console.error('[rate-limiter] Failed to load rules from Redis store:', err);
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
      console.error('[rate-limiter] Failed to subscribe for rule updates:', err);
      return;
    }

    console.info(`[rate-limiter] Subscribed to "${RULES_UPDATE_CHANNEL}"`);
  });

  subscriber.on('message', async (channel) => {
    if (channel !== RULES_UPDATE_CHANNEL) {
      return;
    }

    try {
      const rules = await loadRulesFromStore();
      if (!rules) {
        console.warn('[rate-limiter] Rule update received but Redis store was empty');
        return;
      }

      setRules(rules);
      console.info(`[rate-limiter] Applied ${rules.length} rule(s) from the shared Redis store`);
    } catch (err) {
      console.error('[rate-limiter] Failed to apply shared rule update:', err);
    }
  });

  subscriber.on('error', (err: Error) => {
    console.error('[rate-limiter] Rules subscriber connection error:', err.message);
  });

  return {
    stop: async () => {
      await subscriber.unsubscribe(RULES_UPDATE_CHANNEL);
      subscriber.disconnect();
    },
  };
}
