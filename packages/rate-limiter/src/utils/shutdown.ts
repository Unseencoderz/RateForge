import type { Server }  from 'http';
import type { Redis }   from 'ioredis';

/**
 * P1-M6-T2 · Graceful shutdown handler.
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
 */
export function registerShutdown(redis: Redis, server: Server): void {
  const shutdown = async (signal: string): Promise<void> => {
    console.info(`[shutdown] Received ${signal} — starting graceful shutdown`);

    server.close(async () => {
      console.info('[shutdown] HTTP server closed — disconnecting Redis');
      try {
        await redis.quit();
        console.info('[shutdown] Redis disconnected — exiting');
      } catch (err) {
        console.error('[shutdown] Redis quit error:', err);
      } finally {
        process.exit(0);
      }
    });

    // Force exit after 10 s if drain takes too long (e.g. stuck keep-alive connections)
    setTimeout(() => {
      console.error('[shutdown] Drain timeout — forcing exit');
      process.exit(1);
    }, 10_000).unref();
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT',  () => void shutdown('SIGINT'));
}
