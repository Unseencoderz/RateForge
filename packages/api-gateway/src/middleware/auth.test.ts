import { jest } from '@jest/globals';

import { verifyToken } from './auth';

import type { ClientIdentity } from '@rateforge/types';

// Middleware under test

// Mock config so we do not depend on real env
jest.mock('@rateforge/config', () => ({
  JWT_SECRET: 'test-secret'
}));

// Mock jsonwebtoken to control token verification behaviour
const verifyMock = jest.fn();

jest.mock('jsonwebtoken', () => ({
  __esModule: true,
  default: {
    verify: (...args: any[]) => verifyMock(...args)
  },
  verify: (...args: any[]) => verifyMock(...args)
}));

function createMockReq(headers: Record<string, string | undefined> = {}, ip = '127.0.0.1') {
  return {
    headers,
    ip
  } as { headers: Record<string, string | undefined>; ip: string; clientIdentity?: ClientIdentity };
}

function createMockRes() {
  const status = jest.fn().mockReturnThis();
  const json = jest.fn().mockReturnThis();
  return {
    status,
    json
  };
}

const createNext = () => jest.fn();

describe('auth middleware verifyToken', () => {
  beforeEach(() => {
    verifyMock.mockReset();
  });

  it('allows request with a valid JWT and attaches clientIdentity', async () => {
    const req = createMockReq({ authorization: 'Bearer valid-token' });
    const res = createMockRes();
    const next = createNext();

    verifyMock.mockReturnValueOnce({
      userId: 'user-123',
      tier: 'pro'
    });

    await verifyToken(req as any, res as any, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalledWith(401);
    expect(req.clientIdentity).toEqual({
      userId: 'user-123',
      ip: '127.0.0.1',
      tier: 'pro'
    });
  });

  it('returns 401 when token is missing', async () => {
    const req = createMockReq({});
    const res = createMockRes();
    const next = createNext();

    await verifyToken(req as any, res as any, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('returns 401 when token is malformed', async () => {
    const req = createMockReq({ authorization: 'NotBearer token' });
    const res = createMockRes();
    const next = createNext();

    await verifyToken(req as any, res as any, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('returns 401 when token is expired', async () => {
    const req = createMockReq({ authorization: 'Bearer expired-token' });
    const res = createMockRes();
    const next = createNext();

    const error = new Error('jwt expired');
    (error as any).name = 'TokenExpiredError';
    verifyMock.mockImplementationOnce(() => {
      throw error;
    });

    await verifyToken(req as any, res as any, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('returns 401 when token verification throws any other error', async () => {
    const req = createMockReq({ authorization: 'Bearer bad-token' });
    const res = createMockRes();
    const next = createNext();

    verifyMock.mockImplementationOnce(() => {
      throw new Error('invalid token');
    });

    await verifyToken(req as any, res as any, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });
});

