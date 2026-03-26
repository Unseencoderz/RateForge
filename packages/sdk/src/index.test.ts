import { RateForgeClient } from './index';
import { AlgorithmType, RateLimitRequest } from '@rateforge/types';

describe('RateForgeClient', () => {
  let fetchMock: jest.SpyInstance;

  const defaultReq: RateLimitRequest = {
    clientId: 'user1',
    identity: { userId: 'user1', ip: '127.0.0.1', tier: 'free' },
    endpoint: '/foo',
    method: 'GET',
    timestamp: Date.now(),
    algorithm: AlgorithmType.TOKEN_BUCKET,
  };

  function createPassphraseClient(): RateForgeClient {
    return new RateForgeClient({
      baseUrl: 'http://localhost:3000',
      passphrase: 'enterprise-passphrase',
      timeoutMs: 100,
    });
  }

  function createLegacyClient(): RateForgeClient {
    return new RateForgeClient({
      baseUrl: 'http://localhost:3000',
      apiKey: 'legacy-api-key',
      timeoutMs: 100,
    });
  }

  function mockLogin(token: string = 'issued-admin-token'): void {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        data: { token },
      }),
    });
  }

  beforeEach(() => {
    fetchMock = jest.spyOn(global, 'fetch').mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('constructor', () => {
    it('throws if baseUrl is missing', () => {
      expect(() => new RateForgeClient({} as any)).toThrow('baseUrl is required');
    });

    it('throws if both passphrase and apiKey are missing', () => {
      expect(() => new RateForgeClient({ baseUrl: 'http://test' } as any)).toThrow(
        'passphrase or apiKey is required',
      );
    });

    it('strips trailing slashes from baseUrl', () => {
      const c = new RateForgeClient({ baseUrl: 'http://test/', passphrase: 'secret' });
      expect((c as any).baseUrl).toBe('http://test');
    });
  });

  describe('passphrase authentication', () => {
    it('authenticates before checkLimit() and uses the issued JWT', async () => {
      const client = createPassphraseClient();
      mockLogin('admin-token');
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
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
      expect(fetchMock).toHaveBeenNthCalledWith(
        1,
        'http://localhost:3000/api/v1/admin/login',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ passphrase: 'enterprise-passphrase' }),
        }),
      );
      expect(fetchMock).toHaveBeenNthCalledWith(
        2,
        'http://localhost:3000/api/v1/check',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Bearer admin-token',
          }),
        }),
      );
    });

    it('reuses the cached token across authenticated calls', async () => {
      const client = createPassphraseClient();
      mockLogin('cached-token');
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          data: [
            {
              id: 'rule-1',
              endpointPattern: '/api/*',
              windowMs: 60000,
              maxRequests: 100,
              algorithm: AlgorithmType.TOKEN_BUCKET,
              enabled: true,
            },
          ],
        }),
      });
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          data: {
            clientId: 'user-123',
            deletedKeys: 5,
          },
        }),
      });

      const rules = await client.getRules();
      const reset = await client.resetLimit('user-123');

      expect(rules).toHaveLength(1);
      expect(reset.deletedKeys).toBe(5);
      expect(fetchMock).toHaveBeenCalledTimes(3);
      expect(fetchMock).toHaveBeenNthCalledWith(
        2,
        'http://localhost:3000/api/v1/admin/rules',
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({
            Authorization: 'Bearer cached-token',
          }),
        }),
      );
      expect(fetchMock).toHaveBeenNthCalledWith(
        3,
        'http://localhost:3000/api/v1/admin/reset/user-123',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Bearer cached-token',
          }),
        }),
      );
    });

    it('re-authenticates once after a 401 and retries the request', async () => {
      const client = createPassphraseClient();
      mockLogin('stale-token');
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: async () => ({
          success: false,
          error: { code: 'UNAUTHORIZED', message: 'Invalid or expired token.' },
        }),
      });
      mockLogin('fresh-token');
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          data: [
            {
              id: 'rule-1',
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
      expect(fetchMock).toHaveBeenCalledTimes(4);
      expect(fetchMock).toHaveBeenNthCalledWith(
        4,
        'http://localhost:3000/api/v1/admin/rules',
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer fresh-token',
          }),
        }),
      );
    });

    it('surfaces login failures when the passphrase is rejected', async () => {
      const client = createPassphraseClient();
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: async () => ({
          success: false,
          error: { code: 'UNAUTHORIZED', message: 'Invalid admin passphrase.' },
        }),
      });

      await expect(client.checkLimit(defaultReq)).rejects.toMatchObject({
        status: 401,
        message: 'Invalid admin passphrase.',
      });
    });
  });

  describe('legacy apiKey fallback', () => {
    it('sends the provided apiKey without calling /api/v1/admin/login', async () => {
      const client = createLegacyClient();
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
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
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock).toHaveBeenCalledWith(
        'http://localhost:3000/api/v1/check',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Bearer legacy-api-key',
          }),
        }),
      );
    });
  });

  describe('resetLimit()', () => {
    it('throws if clientId is empty', async () => {
      const client = createPassphraseClient();
      await expect(client.resetLimit('')).rejects.toThrow('clientId must be a non-empty string');
    });
  });

  describe('error handling', () => {
    it('throws on network timeout', async () => {
      const client = createLegacyClient();
      fetchMock.mockRejectedValueOnce(new Error('Network request failed'));

      await expect(client.checkLimit(defaultReq)).rejects.toThrow('Network request failed');
    });

    it('throws SdkError on non-JSON responses', async () => {
      const client = createLegacyClient();
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
