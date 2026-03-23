import { HTTP_STATUS_OK } from '@rateforge/types';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';

import { loadRules } from './config/rules-loader';
import { seedRulesStore } from './config/rules-store';
import { adminRouter } from './controllers/admin.controller';
import { metricsRegistry } from './metrics/registry';
import { errorHandler } from './middleware/error-handler';
import { applyRateLimit } from './middleware/rate-limit';
import { sendRateLimitResponse } from './middleware/rate-limit-response';
import { attachRequestId } from './middleware/request-id';
import { logRequests } from './middleware/request-logger';
import { healthCheck } from './services/health-check';
import { logger } from './utils/logger';
import { bindRequestContext } from './utils/request-context';

import type { Express, Request, Response } from 'express';

export const app: Express = express();
app.set('trust proxy', true);

// ── Core middleware ────────────────────────────────────────────────────────────
app.use(helmet());
app.use(cors());
app.use(express.json());

// ── Request ID middleware (P2-M1-T3) ──────────────────────────────────────────
//
// Attaches a UUID v4 to `req.id` and sets `X-Request-ID` response header on
// every request. Downstream middleware and logs use this as the correlation ID.
app.use(attachRequestId);
app.use((req, _res, next) => {
  bindRequestContext(
    {
      requestId: req.id,
      traceId: req.traceId,
    },
    next,
  );
});
app.use(logRequests);

// ── Health / readiness endpoints (P2-M1-T4) ───────────────────────────────────
//
// /health  → Kubernetes liveness probe (always 200 if process is alive)
// /ready   → Kubernetes readiness probe (checks Redis + rate-limiter connectivity)
app.get('/metrics', async (_req: Request, res: Response): Promise<void> => {
  res.setHeader('Content-Type', metricsRegistry.contentType);
  res.setHeader('Cache-Control', 'no-store');
  res.send(await metricsRegistry.metrics());
});

app.get('/health', (_req: Request, res: Response) => {
  res.status(HTTP_STATUS_OK).json({ status: 'ok' });
});

app.get('/ready', async (_req: Request, res: Response): Promise<void> => {
  const readiness = await healthCheck();
  if (readiness.redis && readiness.rateLimiter) {
    res.status(HTTP_STATUS_OK).json({
      status: 'ready',
      redis: 'connected',
      rateLimiter: 'reachable',
    });
  } else {
    res.status(503).json({
      status: 'not ready',
      redis: readiness.redis ? 'connected' : 'disconnected',
      rateLimiter: readiness.rateLimiter ? 'reachable' : 'unreachable',
    });
  }
});

// ── API v1 router ─────────────────────────────────────────────────────────────
const apiRouter = express.Router();
apiRouter.use(applyRateLimit);
apiRouter.use(sendRateLimitResponse);
app.use('/api/v1', apiRouter);

// Admin routes (P2-M5): GET/POST /rules, POST /reset/:clientId
apiRouter.use('/admin', adminRouter);

// ── Centralised error handler (P2-M1-T2) ─────────────────────────────────────
//
// ⚠️  Must be the LAST middleware registered.
app.use(errorHandler);

// ── Startup sequence ──────────────────────────────────────────────────────────

/**
 * Loads rules from disk, validates them, and starts the Redis Pub/Sub
 * hot-reload watcher.
 *
 * Called from server.ts after the HTTP server is listening.
 *
 * The gateway treats `rules.json` as a bootstrap source only.
 * The shared Redis rules store is the cross-instance source of truth used by
 * the rate-limiter service.
 */
export async function initApp(): Promise<void> {
  const rules = loadRules();
  const seedResult = await seedRulesStore(rules);
  logger.info({
    message: 'Rules store initialised from disk',
    event: 'rules.store.initialised',
    seedResult,
    ruleCount: rules.length,
  });
}
