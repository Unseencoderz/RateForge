/**
 * P1-M (rate-limiter package entry point)
 *
 * HTTP server for the rate-limiter service.
 * Exposes:
 *   POST /api/v1/check          — rate-limit check
 *   POST /api/v1/reset/:clientId — reset limit for a client
 *   GET  /api/v1/rules          — return active rule set
 *   GET  /health                — liveness probe
 */
import express, { type Express } from 'express';
import helmet from 'helmet';

import { PORT } from '@rateforge/config';
import { HTTP_STATUS_OK, HTTP_STATUS_INTERNAL_SERVER_ERROR } from '@rateforge/types';

import { checkLimit, setRules, getRules, resetLimit } from './services/rate-limit.service';
import { createRedisClient, healthCheck } from './redis/client';
import { registerShutdown } from './utils/shutdown';

import type { Request, Response } from 'express';
import type { ApiResponse, RateLimitRequest } from '@rateforge/types';

const app: Express = express();
app.use(helmet());
app.use(express.json());

// ── Liveness probe ─────────────────────────────────────────────────────────────
app.get('/health', (_req: Request, res: Response) => {
  res.status(HTTP_STATUS_OK).json({ status: 'ok' });
});

// ── Rate-limit check (P1-M5-T2) ───────────────────────────────────────────────
app.post('/api/v1/check', async (req: Request, res: Response): Promise<void> => {
  try {
    const result = await checkLimit(req.body as RateLimitRequest);
    res.status(HTTP_STATUS_OK).json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const body: ApiResponse<never> = {
      success: false,
      error: { code: 'INTERNAL_ERROR', message }
    };
    res.status(HTTP_STATUS_INTERNAL_SERVER_ERROR).json(body);
  }
});

// ── Reset client (P2-M5-T3) ───────────────────────────────────────────────────
app.post('/api/v1/reset/:clientId', async (req: Request, res: Response): Promise<void> => {
  const { clientId } = req.params;
  try {
    const deletedKeys = await resetLimit(clientId);
    const body: ApiResponse<{ clientId: string; deletedKeys: number }> = {
      success: true,
      data: { clientId, deletedKeys }
    };
    res.status(HTTP_STATUS_OK).json(body);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(HTTP_STATUS_INTERNAL_SERVER_ERROR).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message }
    });
  }
});

// ── Get rules ─────────────────────────────────────────────────────────────────
app.get('/api/v1/rules', (_req: Request, res: Response) => {
  const rules = getRules();
  const body: ApiResponse<typeof rules> = { success: true, data: rules };
  res.status(HTTP_STATUS_OK).json(body);
});

// ── Startup ───────────────────────────────────────────────────────────────────
const port = PORT ?? 3001;

healthCheck().then((ok) => {
  if (!ok) {
    console.warn('[rate-limiter] Redis not reachable on startup — proceeding in degraded mode');
  }
});

const server = app.listen(port, () => {
  console.info(`[rate-limiter] Service listening on port ${port}`);
});

registerShutdown(createRedisClient(), server);

// Exports for tests
export { app, setRules };
