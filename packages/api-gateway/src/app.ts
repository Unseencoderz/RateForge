import {
  ADMIN_PASSPHRASE,
  DOWNSTREAM_TARGET_URL,
  FRONTEND_URL,
  JWT_SECRET,
} from '@rateforge/config';
import { HTTP_STATUS_OK, HTTP_STATUS_UNAUTHORIZED } from '@rateforge/types';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { createProxyMiddleware, fixRequestBody } from 'http-proxy-middleware';
import jwt from 'jsonwebtoken';

import { loadRules } from './config/rules-loader';
import { seedRulesStore } from './config/rules-store';
import { adminRouter } from './controllers/admin.controller';
import { metricsRegistry } from './metrics/registry';
import { verifyToken } from './middleware/auth';
import { errorHandler } from './middleware/error-handler';
import { applyRateLimit } from './middleware/rate-limit';
import { sendRateLimitResponse } from './middleware/rate-limit-response';
import { attachRequestId } from './middleware/request-id';
import { logRequests } from './middleware/request-logger';
import { healthCheck } from './services/health-check';
import { checkLimit as checkLimitWithLimiter } from './services/rate-limiter.client';
import { logger } from './utils/logger';
import { bindRequestContext } from './utils/request-context';

import type { ApiResponse, RateLimitRequest, RateLimitResult } from '@rateforge/types';
import type { Express, NextFunction, Request, Response } from 'express';

interface AdminLoginRequestBody {
  passphrase?: unknown;
}

export const app: Express = express();
app.set('trust proxy', true);

const adminPlaneRouter = express.Router();
adminPlaneRouter.use(applyRateLimit);
adminPlaneRouter.use(sendRateLimitResponse);
adminPlaneRouter.use(adminRouter);
adminPlaneRouter.use((req: Request, res: Response) => {
  res.status(404).send(`Cannot ${req.method} ${req.originalUrl}`);
});

const dataPlaneProxy = createProxyMiddleware({
  target: DOWNSTREAM_TARGET_URL,
  changeOrigin: true,
  xfwd: true,
  on: {
    proxyReq: fixRequestBody,
  },
});

// ── Core middleware ────────────────────────────────────────────────────────────
app.use(helmet());
app.use(cors({ origin: FRONTEND_URL }));
app.use(express.json());

// ── Request ID middleware ─────────────────────────────────────────────────────
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

// ── Health / readiness endpoints ──────────────────────────────────────────────
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
app.post('/api/v1/admin/login', (req: Request, res: Response) => {
  const { passphrase } = req.body as AdminLoginRequestBody;

  if (typeof passphrase !== 'string' || passphrase !== ADMIN_PASSPHRASE) {
    const body: ApiResponse<never> = {
      success: false,
      error: {
        code: 'UNAUTHORIZED',
        message: 'Invalid admin passphrase.',
      },
    };

    res.status(HTTP_STATUS_UNAUTHORIZED).json(body);
    return;
  }

  const token = jwt.sign(
    {
      userId: 'admin',
      role: 'admin',
      isAdmin: true,
    },
    JWT_SECRET,
    { expiresIn: '7d' },
  );

  const body: ApiResponse<{ token: string }> = {
    success: true,
    data: { token },
  };

  res.status(HTTP_STATUS_OK).json(body);
});

app.post('/api/v1/check', verifyToken, (req: Request, res: Response, next: NextFunction): void => {
  void (async () => {
    const result = await checkLimitWithLimiter(req.body as RateLimitRequest);

    const body: ApiResponse<RateLimitResult> = {
      success: true,
      data: result,
    };

    res.status(HTTP_STATUS_OK).json(body);
  })().catch(next);
});

// Admin routes
app.use('/api/v1/admin', adminPlaneRouter);

// Generic data-plane: rate-limit first, then forward to the configured target.
app.use(applyRateLimit);
app.use(sendRateLimitResponse);
app.use(dataPlaneProxy);

// ── Centralised error handler ────────────────────────────────────────────────
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
