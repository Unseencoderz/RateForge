import { REDIS_URL } from '@rateforge/config';
import IORedis, { Redis } from 'ioredis';

import { markRedisError, markRedisHealthy } from '../metrics/registry';
import { getErrorMeta, logger } from '../utils/logger';

let client: Redis | null = null;

export function createRedisClient(): Redis {
  if (client) {
    return client;
  }

  client = new IORedis(REDIS_URL, {
    maxRetriesPerRequest: 5,
    connectTimeout: 5_000,
    retryStrategy(times) {
      const delay = Math.min(times * 200, 5_000);
      return delay;
    },
  });

  client.on('ready', () => {
    markRedisHealthy('client');
    logger.info({
      message: 'Redis client ready',
      event: 'redis.client_ready',
    });
  });

  client.on('error', (err: Error) => {
    markRedisError('client');
    logger.error({
      message: 'Redis client error',
      event: 'redis.client_error',
      ...getErrorMeta(err),
    });
  });

  client.on('reconnecting', (delay: number) => {
    markRedisError('client');
    logger.warn({
      message: 'Redis client reconnecting',
      event: 'redis.client_reconnecting',
      delayMs: delay,
    });
  });

  return client;
}

export async function healthCheck(): Promise<boolean> {
  const redis = createRedisClient();

  try {
    const result = await redis.ping();
    markRedisHealthy('health_check');
    return result === 'PONG';
  } catch {
    markRedisError('health_check');
    return false;
  }
}
