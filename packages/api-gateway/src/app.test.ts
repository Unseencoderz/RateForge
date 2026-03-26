import { jest } from '@jest/globals';
import { AlgorithmType } from '@rateforge/types';
import jwt from 'jsonwebtoken';
import request from 'supertest';

import type { RateLimitRequest, RateLimitResult } from '@rateforge/types';

const checkLimitMock = jest.fn<() => Promise<RateLimitResult>>();
const isBlacklistedMock = jest.fn<() => Promise<boolean>>();
const isWhitelistedMock = jest.fn<() => Promise<boolean>>();
const proxyMiddlewareMock = jest.fn((req: any, res: any) => {
  res.status(200).json({
    proxied: true,
    method: req.method,
    path: req.originalUrl,
  });
});
const createProxyMiddlewareMock = jest.fn(() => proxyMiddlewareMock as any);

jest.mock('@rateforge/config', () => ({
  FRONTEND_URL: 'http://localhost:4000',
  DOWNSTREAM_TARGET_URL: 'http://localhost:8080',
  ADMIN_PASSPHRASE: 'enterprise-passphrase',
  REDIS_URL: 'redis://localhost:6379',
  RATE_LIMITER_URL: 'http://localhost:3001',
  JWT_SECRET: 'test-secret',
  NODE_ENV: 'test',
  PORT: 3000,
  LOG_LEVEL: 'info',
}));

jest.mock('./services/rate-limiter.client', () => ({
  checkLimit: (...args: any[]) => (checkLimitMock as any)(...args),
  getRules: jest.fn(),
  resetLimit: jest.fn(),
  addToBlacklist: jest.fn(),
  addToWhitelist: jest.fn(),
  isBlacklisted: (...args: any[]) => (isBlacklistedMock as any)(...args),
  isWhitelisted: (...args: any[]) => (isWhitelistedMock as any)(...args),
}));

jest.mock('./middleware/auth', () => ({
  verifyToken: (req: any, res: any, next: any) => {
    const authHeader = req.headers['authorization'];

    if (!authHeader || !String(authHeader).startsWith('Bearer ')) {
      res.status(401).json({
        success: false,
        error: {
          code: 'UNAUTHORIZED',
          message: 'Missing or malformed Authorization header.',
        },
      });
      return;
    }

    req.clientIdentity = {
      userId: 'sdk-user',
      ip: req.ip ?? '127.0.0.1',
      tier: 'pro',
    };
    req.authToken = {
      userId: 'sdk-user',
      role: 'admin',
    };
    next();
  },
  requireAdmin: (req: any, res: any, next: any) => {
    if (req.authToken?.role === 'admin') {
      next();
      return;
    }

    res.status(403).json({
      success: false,
      error: {
        code: 'FORBIDDEN',
        message: 'Admin privileges are required for this endpoint.',
      },
    });
  },
}));

jest.mock('./middleware/request-id', () => ({
  attachRequestId: (req: any, _res: any, next: any) => {
    req.id = 'req-test';
    next();
  },
}));

jest.mock(
  'http-proxy-middleware',
  () => ({
    createProxyMiddleware: (...args: any[]) => (createProxyMiddlewareMock as any)(...args),
    fixRequestBody: jest.fn(),
  }),
  { virtual: true },
);

jest.mock('./metrics/registry', () => ({
  metricsRegistry: {
    contentType: 'text/plain',
    metrics: jest.fn(async () => 'metrics'),
  },
  recordBlockedRequest: jest.fn(),
  recordHttpRequest: jest.fn(),
}));

jest.mock('./utils/logger', () => {
  const requestLogger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    log: jest.fn(),
  };

  return {
    logger: requestLogger,
    getErrorMeta: jest.fn(() => ({})),
    getRequestLogger: jest.fn(() => requestLogger),
  };
});

import { app } from './app';

const ALLOWED_RESULT: RateLimitResult = {
  allowed: true,
  limit: 60,
  remaining: 59,
  resetAt: 1_700_000_060_000,
  ruleId: 'default',
};

const BLOCKED_RESULT: RateLimitResult = {
  allowed: false,
  limit: 60,
  remaining: 0,
  resetAt: 1_700_000_060_000,
  retryAfterMs: 30_000,
  ruleId: 'default',
  reason: 'TOKEN_BUCKET_EXHAUSTED',
};

const SDK_CHECK_REQUEST: RateLimitRequest = {
  clientId: 'user-123',
  identity: {
    userId: 'user-123',
    ip: '127.0.0.1',
    tier: 'pro',
  },
  endpoint: '/api/users',
  method: 'GET',
  timestamp: 1_700_000_000_000,
  algorithm: AlgorithmType.TOKEN_BUCKET,
};

describe('gateway app routing', () => {
  beforeEach(() => {
    checkLimitMock.mockReset();
    checkLimitMock.mockResolvedValue(ALLOWED_RESULT);

    isBlacklistedMock.mockReset();
    isBlacklistedMock.mockResolvedValue(false);

    isWhitelistedMock.mockReset();
    isWhitelistedMock.mockResolvedValue(false);

    proxyMiddlewareMock.mockClear();
  });

  it('forwards POST /api/v1/check through the gateway and wraps the limiter result', async () => {
    const res = await request(app)
      .post('/api/v1/check')
      .set('authorization', 'Bearer sdk-token')
      .send(SDK_CHECK_REQUEST);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      success: true,
      data: ALLOWED_RESULT,
    });
    expect(checkLimitMock).toHaveBeenCalledWith(SDK_CHECK_REQUEST);
    expect(proxyMiddlewareMock).not.toHaveBeenCalled();
  });

  it('rejects POST /api/v1/check when the bearer token is missing', async () => {
    const res = await request(app).post('/api/v1/check').send(SDK_CHECK_REQUEST);

    expect(res.status).toBe(401);
    expect(checkLimitMock).not.toHaveBeenCalled();
    expect(proxyMiddlewareMock).not.toHaveBeenCalled();
  });

  it('issues an admin JWT from POST /api/v1/admin/login without requiring bearer auth', async () => {
    const res = await request(app)
      .post('/api/v1/admin/login')
      .send({ passphrase: 'enterprise-passphrase' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(typeof res.body.data?.token).toBe('string');

    const payload = jwt.verify(res.body.data.token, 'test-secret') as {
      userId: string;
      role: string;
      isAdmin: boolean;
    };

    expect(payload).toMatchObject({
      userId: 'admin',
      role: 'admin',
      isAdmin: true,
    });
    expect(checkLimitMock).not.toHaveBeenCalled();
    expect(proxyMiddlewareMock).not.toHaveBeenCalled();
  });

  it('rejects POST /api/v1/admin/login when the passphrase is wrong', async () => {
    const res = await request(app).post('/api/v1/admin/login').send({ passphrase: 'wrong' });

    expect(res.status).toBe(401);
    expect(res.body).toEqual({
      success: false,
      error: {
        code: 'UNAUTHORIZED',
        message: 'Invalid admin passphrase.',
      },
    });
    expect(checkLimitMock).not.toHaveBeenCalled();
    expect(proxyMiddlewareMock).not.toHaveBeenCalled();
  });

  it('proxies approved generic traffic to the configured downstream target', async () => {
    const res = await request(app).get('/api/users');

    expect(createProxyMiddlewareMock).toHaveBeenCalledWith(
      expect.objectContaining({
        target: 'http://localhost:8080',
        changeOrigin: true,
        xfwd: true,
      }),
    );
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      proxied: true,
      method: 'GET',
      path: '/api/users',
    });
    expect(proxyMiddlewareMock).toHaveBeenCalledTimes(1);
  });

  it('returns 429 before proxying when generic traffic is blocked', async () => {
    checkLimitMock.mockResolvedValueOnce(BLOCKED_RESULT);

    const res = await request(app).get('/api/users');

    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe('RATE_LIMIT_EXCEEDED');
    expect(proxyMiddlewareMock).not.toHaveBeenCalled();
  });

  it('keeps unknown admin routes local instead of proxying them downstream', async () => {
    const res = await request(app)
      .get('/api/v1/admin/unknown')
      .set('authorization', 'Bearer admin');

    expect(res.status).toBe(404);
    expect(proxyMiddlewareMock).not.toHaveBeenCalled();
  });
});
