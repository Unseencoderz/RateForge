import { REDIS_URL } from '@rateforge/config';
import IORedis, { Redis } from 'ioredis';

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
    }
  });

  return client;
}

export async function healthCheck(): Promise<boolean> {
  const redis = createRedisClient();

  try {
    const result = await redis.ping();
    return result === 'PONG';
  } catch {
    return false;
  }
}


