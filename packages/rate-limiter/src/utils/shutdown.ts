import { getErrorMeta, logger } from './logger';

import type { Server } from 'http';
import type { Redis } from 'ioredis';

/**
 * Graceful shutdown handler.
 *
 * Registers SIGTERM and SIGINT handlers that:
 *   1. Stop accepting new connections (server.close).
 *   2. Wait for in-flight requests to drain (server close callback).
 *   3. Disconnect from Redis cleanly.
 *   4. Call process.exit(0).
 *
 * Without this, a Kubernetes rolling update may drop in-flight requests
 * because the pod is killed while it still has open TCP connections.
 *
 * @param redis  The singleton Redis client to disconnect on shutdown.
 * @param server The HTTP server returned by app.listen().
 * @param cleanup Optional async cleanup for additional long-lived resources.
 */
export function registerShutdown(
  redis: Redis,
  server: Server,
  cleanup?: () => Promise<void>,
): void {
  const shutdown = async (signal: string): Promise<void> => {
    logger.info({
      message: 'Shutdown signal received',
      event: 'shutdown.started',
      signal,
    });

    server.close(async () => {
      logger.info({
        message: 'HTTP server closed; cleaning up resources',
        event: 'shutdown.server_closed',
      });
      try {
        if (cleanup) {
          await cleanup();
        }
        await redis.quit();
        logger.info({
          message: 'Redis disconnected; exiting process',
          event: 'shutdown.redis_closed',
        });
      } catch (err) {
        logger.error({
          message: 'Redis quit failed during shutdown',
          event: 'shutdown.redis_close_failed',
          ...getErrorMeta(err),
        });
      } finally {
        process.exit(0);
      }
    });

    // Force exit after 10 s if drain takes too long (e.g. stuck keep-alive connections)
    setTimeout(() => {
      logger.error({
        message: 'Shutdown drain timeout reached; forcing exit',
        event: 'shutdown.timeout',
        signal,
      });
      process.exit(1);
    }, 10_000).unref();
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}
