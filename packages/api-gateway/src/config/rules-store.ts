import { REDIS_URL } from '@rateforge/config';
import { RULES_STORE_KEY, RULES_UPDATE_CHANNEL } from '@rateforge/types';
import IORedis from 'ioredis';

import type { RuleConfig } from '@rateforge/types';

let redis: IORedis | null = null;

function getRedis(): IORedis {
  if (!redis) {
    redis = new IORedis(REDIS_URL, {
      maxRetriesPerRequest: 3,
      connectTimeout: 5_000,
    });
  }

  return redis;
}

export async function seedRulesStore(rules: RuleConfig[]): Promise<'seeded' | 'already-present'> {
  const result = await getRedis().set(RULES_STORE_KEY, JSON.stringify(rules), 'NX');

  if (result === 'OK') {
    await getRedis().publish(RULES_UPDATE_CHANNEL, 'seed');
    return 'seeded';
  }

  return 'already-present';
}

export async function persistRulesToStore(rules: RuleConfig[]): Promise<void> {
  await getRedis().set(RULES_STORE_KEY, JSON.stringify(rules));
  await getRedis().publish(RULES_UPDATE_CHANNEL, 'update');
}
