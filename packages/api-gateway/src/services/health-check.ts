import { RATE_LIMITER_URL, REDIS_URL } from '@rateforge/config';
import IORedis from 'ioredis';

export interface GatewayReadiness {
  rateLimiter: boolean;
  redis: boolean;
}

let probeClient: IORedis | null = null;

function getProbeClient(): IORedis {
  if (!probeClient) {
    probeClient = new IORedis(REDIS_URL, {
      maxRetriesPerRequest: 1,
      connectTimeout: 2_000,
      lazyConnect: true,
    });
    probeClient.on('error', () => {
      // Swallow errors — readiness returns false on failure.
    });
  }

  return probeClient;
}

async function checkRedis(): Promise<boolean> {
  try {
    const result = await getProbeClient().ping();
    return result === 'PONG';
  } catch {
    return false;
  }
}

async function checkRateLimiter(): Promise<boolean> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2_000);

  try {
    const response = await fetch(`${RATE_LIMITER_URL}/health`, {
      signal: controller.signal,
    });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

export async function healthCheck(): Promise<GatewayReadiness> {
  const [redis, rateLimiter] = await Promise.all([checkRedis(), checkRateLimiter()]);
  return { redis, rateLimiter };
}
