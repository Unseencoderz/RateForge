import { RateForgeClient } from './index';
import { AlgorithmType, RateLimitRequest } from '@rateforge/types';

describe('RateForgeClient', () => {
  let client: RateForgeClient;
  let fetchMock: jest.SpyInstance;

  beforeEach(() => {
    client = new RateForgeClient({
      baseUrl: 'http://localhost:3000',
      apiKey: 'test-api-key',
      timeoutMs: 100,
    });
    fetchMock = jest.spyOn(global, 'fetch').mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('constructor', () => {
    it('throws if baseUrl is missing', () => {
      expect(() => new RateForgeClient({} as any)).toThrow('baseUrl is required');
    });

    it('throws if apiKey is missing', () => {
      expect(() => new RateForgeClient({ baseUrl: 'http://test' } as any)).toThrow(
        'apiKey is required',
      );
    });

    it('strips trailing slashes from baseUrl', () => {
      const c = new RateForgeClient({ baseUrl: 'http://test/', apiKey: 'key' });
      expect((c as any).baseUrl).toBe('http://test');
    });
  });

  describe('checkLimit()', () => {
    const defaultReq: RateLimitRequest = {
      clientId: 'user1',
      identity: { userId: 'user1', ip: '127.0.0.1', tier: 'free' },
      endpoint: '/foo',
      method: 'GET',
      timestamp: Date.now(),
      algorithm: AlgorithmType.TOKEN_BUCKET,
    };

    it('returns result on success (200)', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          data: {
            allowed: true,
            limit: 100,
            remaining: 99,
            resetAt: Date.now() + 60000,
          },
        }),
      });

      const result = await client.checkLimit(defaultReq);
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(99);

      expect(fetchMock).toHaveBeenCalledWith(
        'http://localhost:3000/api/v1/check',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Bearer test-api-key',
          }),
        }),
      );
    });

    it('returns a blocked result when the gateway responds with allowed=false', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          data: { allowed: false, limit: 100, remaining: 0, resetAt: Date.now() + 60000 },
        }),
      });

      await expect(client.checkLimit(defaultReq)).resolves.toMatchObject({
        allowed: false,
        remaining: 0,
      });
    });

    it('throws on network timeout', async () => {
      fetchMock.mockRejectedValueOnce(new Error('Network request failed'));
      await expect(client.checkLimit(defaultReq)).rejects.toThrow('Network request failed');
    });
  });

  describe('resetLimit()', () => {
    it('returns success for valid clientId', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          data: {
            clientId: 'user-123',
            deletedKeys: 5,
          },
        }),
      });

      const res = await client.resetLimit('user-123');
      expect(res.clientId).toBe('user-123');
      expect(res.deletedKeys).toBe(5);
      expect(fetchMock).toHaveBeenCalledWith(
        'http://localhost:3000/api/v1/admin/reset/user-123',
        expect.objectContaining({
          method: 'POST',
        }),
      );
    });

    it('throws if clientId is empty', async () => {
      await expect(client.resetLimit('')).rejects.toThrow('clientId must be a non-empty string');
    });

    it('throws SdkError if server returns 500', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => ({
          success: false,
          error: { code: 'INTERNAL_ERROR', message: 'Failed to reset' },
        }),
      });

      await expect(client.resetLimit('error-client')).rejects.toMatchObject({
        status: 500,
        message: 'Failed to reset',
      });
    });
  });

  describe('getRules()', () => {
    it('returns parsed rule config array', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          data: [
            {
              id: 'test-rule',
              endpointPattern: '/api/*',
              windowMs: 60000,
              maxRequests: 100,
              algorithm: AlgorithmType.TOKEN_BUCKET,
              enabled: true,
            },
          ],
        }),
      });

      const rules = await client.getRules();
      expect(rules).toHaveLength(1);
      expect(rules[0].id).toBe('test-rule');
    });

    it('throws SdkError on non-JSON response', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 503,
        json: async () => {
          throw new Error('invalid json');
        },
      });

      await expect(client.getRules()).rejects.toMatchObject({
        status: 503,
        message: expect.stringContaining('Non-JSON response'),
      });
    });
  });
});
