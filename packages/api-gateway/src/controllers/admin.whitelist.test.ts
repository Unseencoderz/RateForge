import { jest } from '@jest/globals';
import express from 'express';
import request from 'supertest';

const addToBlacklistMock = jest.fn<() => Promise<void>>().mockResolvedValue(undefined);
const addToWhitelistMock = jest.fn<() => Promise<void>>().mockResolvedValue(undefined);

jest.mock('../services/rate-limiter.client', () => ({
  getRules:         jest.fn().mockReturnValue([]),
  resetLimit: jest.fn<() => Promise<number>>().mockResolvedValue(0),
  addToBlacklist:   (...args: any[]) => (addToBlacklistMock as any)(...args),
  addToWhitelist:   (...args: any[]) => (addToWhitelistMock as any)(...args),
}));

jest.mock('ioredis', () => {
  const M = jest.fn().mockImplementation(() => ({ publish: jest.fn<any>().mockResolvedValue(1) })) as any;
  (M as any).default = M;
  return { __esModule: true, default: M };
});

jest.mock('@rateforge/config', () => ({ REDIS_URL: 'redis://localhost:6379' }));
jest.mock('../config/rules-loader', () => ({ getRulesPath: () => '/fake/rules.json' }));
jest.mock('../config/rules-watcher', () => ({ RULES_UPDATE_CHANNEL: 'rateforge:rules:update' }));
jest.mock('fs', () => ({ writeFileSync: jest.fn(), renameSync: jest.fn() }));

import { adminRouter } from './admin.controller';

function buildApp() {
  const app = express();
  app.use('/api/v1/admin', adminRouter);
  return app;
}

describe('POST /api/v1/admin/blacklist (P2-M5-T4)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns 200 and calls addToBlacklist with the provided IP', async () => {
    const res = await request(buildApp())
      .post('/api/v1/admin/blacklist')
      .send({ ip: '1.2.3.4' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(addToBlacklistMock).toHaveBeenCalledWith('1.2.3.4');
  });

  it('returns 400 when ip is missing', async () => {
    const res = await request(buildApp()).post('/api/v1/admin/blacklist').send({});
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('returns 400 when ip is an empty string', async () => {
    const res = await request(buildApp()).post('/api/v1/admin/blacklist').send({ ip: '' });
    expect(res.status).toBe(400);
  });
});

describe('POST /api/v1/admin/whitelist (P2-M5-T4)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns 200 and calls addToWhitelist with the provided IP', async () => {
    const res = await request(buildApp())
      .post('/api/v1/admin/whitelist')
      .send({ ip: '10.0.0.1' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(addToWhitelistMock).toHaveBeenCalledWith('10.0.0.1');
  });

  it('returns 400 when ip is missing', async () => {
    const res = await request(buildApp()).post('/api/v1/admin/whitelist').send({});
    expect(res.status).toBe(400);
  });
});