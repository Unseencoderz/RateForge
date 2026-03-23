/**
 * Rate Limiter Service Entry Point
 */

import { PORT } from '@rateforge/config';
import {
  HTTP_STATUS_OK,
  HTTP_STATUS_INTERNAL_SERVER_ERROR,
  HTTP_STATUS_BAD_REQUEST,
} from '@rateforge/types';
import express, { type Express, type Request, type Response } from 'express';
import helmet from 'helmet';
import { z } from 'zod';

import { initialiseRulesFromStore, startRulesSubscriber } from './config/rules-store';
import { requireInternalService } from './middleware/internal-auth';
import { createRedisClient, healthCheck } from './redis/client';
import { checkLimit, setRules, getRules, resetLimit } from './services/rate-limit.service';
import { registerShutdown } from './utils/shutdown';

import type { ApiResponse, RateLimitRequest } from '@rateforge/types';

const app: Express = express();
app.use(helmet());
app.use(express.json());

const BLACKLIST_KEY = 'rateforge:blacklist';
const WHITELIST_KEY = 'rateforge:whitelist';

const RateLimitRequestSchema = z.object({
  clientId: z.string().min(1),
  identity: z.object({
    userId: z.string(),
    ip: z.string(),
    tier: z.string(),
  }),
  endpoint: z.string(),
  method: z.string(),
  timestamp: z.number(),
  algorithm: z.string(),
});

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

app.use('/api/v1', requireInternalService);

app.post('/api/v1/check', async (req: Request, res: Response): Promise<void> => {
  const parsed = RateLimitRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(HTTP_STATUS_BAD_REQUEST).json({
      success: false,
      error: { code: 'BAD_REQUEST', message: 'Invalid RateLimitRequest body.' },
    });
    return;
  }

  try {
    const result = await checkLimit(parsed.data as RateLimitRequest);
    res.status(HTTP_STATUS_OK).json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(HTTP_STATUS_INTERNAL_SERVER_ERROR).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message },
    });
  }
});

app.post('/api/v1/reset/:clientId', async (req: Request, res: Response): Promise<void> => {
  const { clientId } = req.params;

  try {
    const deletedKeys = await resetLimit(clientId);

    const body: ApiResponse<{ clientId: string; deletedKeys: number }> = {
      success: true,
      data: { clientId, deletedKeys },
    };

    res.status(HTTP_STATUS_OK).json(body);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);

    res.status(HTTP_STATUS_INTERNAL_SERVER_ERROR).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message },
    });
  }
});

app.get('/api/v1/rules', (_req: Request, res: Response) => {
  const rules = getRules();

  const body: ApiResponse<typeof rules> = {
    success: true,
    data: rules,
  };

  res.status(HTTP_STATUS_OK).json(body);
});

app.post('/api/v1/blacklist', async (req: Request, res: Response): Promise<void> => {
  const { ip } = req.body as { ip?: string };

  if (!ip || typeof ip !== 'string') {
    res.status(HTTP_STATUS_BAD_REQUEST).json({
      success: false,
      error: { code: 'BAD_REQUEST', message: 'ip required' },
    });
    return;
  }

  try {
    const redis = createRedisClient();
    await redis.sadd(BLACKLIST_KEY, ip);

    res.status(HTTP_STATUS_OK).json({
      success: true,
      data: { ip, list: 'blacklist' },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);

    res.status(HTTP_STATUS_INTERNAL_SERVER_ERROR).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message },
    });
  }
});

app.get('/api/v1/blacklist/check', async (req: Request, res: Response): Promise<void> => {
  const ip = req.query['ip'] as string;

  if (!ip) {
    res.status(HTTP_STATUS_BAD_REQUEST).json({
      success: false,
      error: { code: 'BAD_REQUEST', message: 'ip required' },
    });
    return;
  }

  try {
    const redis = createRedisClient();
    const member = await redis.sismember(BLACKLIST_KEY, ip);

    res.status(HTTP_STATUS_OK).json({
      blacklisted: member === 1,
    });
  } catch {
    res.status(HTTP_STATUS_OK).json({ blacklisted: false });
  }
});

app.post('/api/v1/whitelist', async (req: Request, res: Response): Promise<void> => {
  const { ip } = req.body as { ip?: string };

  if (!ip || typeof ip !== 'string') {
    res.status(HTTP_STATUS_BAD_REQUEST).json({
      success: false,
      error: { code: 'BAD_REQUEST', message: 'ip required' },
    });
    return;
  }

  try {
    const redis = createRedisClient();
    await redis.sadd(WHITELIST_KEY, ip);

    res.status(HTTP_STATUS_OK).json({
      success: true,
      data: { ip, list: 'whitelist' },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);

    res.status(HTTP_STATUS_INTERNAL_SERVER_ERROR).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message },
    });
  }
});

app.get('/api/v1/whitelist/check', async (req: Request, res: Response): Promise<void> => {
  const ip = req.query['ip'] as string;

  if (!ip) {
    res.status(HTTP_STATUS_BAD_REQUEST).json({
      success: false,
      error: { code: 'BAD_REQUEST', message: 'ip required' },
    });
    return;
  }

  try {
    const redis = createRedisClient();
    const member = await redis.sismember(WHITELIST_KEY, ip);

    res.status(HTTP_STATUS_OK).json({
      whitelisted: member === 1,
    });
  } catch {
    res.status(HTTP_STATUS_OK).json({ whitelisted: false });
  }
});

async function bootstrap(): Promise<void> {
  const redis = createRedisClient();
  const redisOk = await healthCheck();

  if (!redisOk) {
    console.warn('[rate-limiter] Redis not reachable on startup — proceeding in degraded mode');
  }

  await initialiseRulesFromStore();
  const rulesSubscriber = startRulesSubscriber();

  const port = PORT ?? 3001;
  const server = app.listen(port, () => {
    console.info(`[rate-limiter] Service listening on port ${port}`);
  });

  registerShutdown(redis, server, async () => {
    await rulesSubscriber.stop();
  });
}

bootstrap().catch((err: unknown) => {
  console.error('[rate-limiter] Failed to bootstrap service:', err);
  process.exit(1);
});

export { app, setRules };
