import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { v4 as uuidv4 } from 'uuid';

import { HTTP_STATUS_OK, HTTP_STATUS_INTERNAL_SERVER_ERROR } from '@rateforge/types';

import { adminRouter } from './controllers/admin.controller';
import { loadRules } from './config/rules-loader';
import { startRulesWatcher } from './config/rules-watcher';
import { healthCheck } from './services/health-check';

import type { Express, Request, Response, NextFunction } from 'express';
import type { ApiResponse } from '@rateforge/types';

export const app: Express = express();

// ── Core middleware ────────────────────────────────────────────────────────────
app.use(helmet());
app.use(cors());
app.use(express.json());

// ── Request ID middleware (P2-M1-T3) ──────────────────────────────────────────
//
// Attaches a UUID v4 to `req.id` and sets `X-Request-ID` response header on
// every request. Downstream middleware and logs use this as the correlation ID.
app.use((req: Request, res: Response, next: NextFunction) => {
  const requestId = uuidv4();
  (req as Request & { id: string }).id = requestId;
  res.setHeader('X-Request-ID', requestId);
  next();
});

// ── Health / readiness endpoints (P2-M1-T4) ───────────────────────────────────
//
// /health  → Kubernetes liveness probe (always 200 if process is alive)
// /ready   → Kubernetes readiness probe (checks Redis connectivity)
app.get('/health', (_req: Request, res: Response) => {
  res.status(HTTP_STATUS_OK).json({ status: 'ok' });
});

app.get('/ready', async (_req: Request, res: Response): Promise<void> => {
  const redisOk = await healthCheck();
  if (redisOk) {
    res.status(HTTP_STATUS_OK).json({ status: 'ready', redis: 'connected' });
  } else {
    res.status(503).json({ status: 'not ready', redis: 'disconnected' });
  }
});

// ── API v1 router ─────────────────────────────────────────────────────────────
const apiRouter = express.Router();
app.use('/api/v1', apiRouter);

// Admin routes (P2-M5): GET/POST /rules, POST /reset/:clientId
apiRouter.use('/admin', adminRouter);

// ── Centralised error handler (P2-M1-T2) ─────────────────────────────────────
//
// ⚠️  Must be the LAST middleware registered.
// Catches any error passed via next(err) and maps it to ApiResponse shape.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const message = err instanceof Error ? err.message : 'Internal server error';
  console.error('[error-handler]', err);
  const body: ApiResponse<never> = {
    success: false,
    error: {
      code: 'INTERNAL_ERROR',
      message
    }
  };
  res.status(HTTP_STATUS_INTERNAL_SERVER_ERROR).json(body);
});

// ── Startup sequence ──────────────────────────────────────────────────────────

/**
 * Loads rules from disk, validates them, and starts the Redis Pub/Sub
 * hot-reload watcher.
 *
 * Called from server.ts after the HTTP server is listening.
 *
 * Rules are loaded from disk and applied to the rate-limiter service's in-memory store
 * via the hot-reload watcher (startRulesWatcher). The api-gateway process itself does
 * not maintain a rule store — it delegates all rate-limit decisions to the rate-limiter
 * service over HTTP.
 */
export async function initApp(): Promise<void> {
  // Validate rules.json on startup so a misconfigured file is caught immediately.
  // The watcher will apply the rules to the rate-limiter when it fires.
  loadRules();  // throws on invalid config → process.exit(1) via server.ts catch

  console.info('[app] rules.json validated — starting hot-reload watcher');

  // Start hot-reload watcher for runtime rule updates
  startRulesWatcher({
    onReloaded: (rules) => {
      console.info(`[app] Hot-reloaded ${rules.length} rule(s)`);
    },
    onError: (err) => {
      console.error('[app] Rules hot-reload error (keeping existing rules):', err);
    }
  });
}
