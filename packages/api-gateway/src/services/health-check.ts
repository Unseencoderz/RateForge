import { REDIS_URL } from '@rateforge/config';
import IORedis from 'ioredis';

/**
 * Lightweight Redis health check for the API gateway's /ready endpoint.
 *
 * Uses a separate, short-lived connection so the gateway can check Redis
 * connectivity without depending on the rate-limiter package directly.
 * The connection is reused across calls (singleton pattern).
 */
let probeClient: IORedis | null = null;

function getProbeClient(): IORedis {
  if (!probeClient) {
    probeClient = new IORedis(REDIS_URL, {
      maxRetriesPerRequest: 1,
      connectTimeout: 2_000,
      lazyConnect: true
    });
    probeClient.on('error', () => {
      // Swallow errors — healthCheck returns false on failure
    });
  }
  return probeClient;
}

/**
 * Returns `true` if the Redis server responds to PING within the timeout,
 * `false` on any error or timeout.
 */
export async function healthCheck(): Promise<boolean> {
  try {
    const result = await getProbeClient().ping();
    return result === 'PONG';
  } catch {
    return false;
  }
}
