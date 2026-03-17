import IORedis from 'ioredis';

import { createRedisClient, healthCheck } from './client';

import type { Redis } from 'ioredis';

jest.mock('@rateforge/config', () => ({
  REDIS_URL: 'redis://localhost:6379'
}));

// Provide mocked IORedis properly avoiding jest.mock hoisting reference errors.
jest.mock('ioredis', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const MockIORedis = require('ioredis-mock');
  const instance = new MockIORedis();
  const MockRedisFn = jest.fn().mockImplementation(() => instance);
  
  // Attach instance so tests can access it via the constructor
  Object.defineProperty(MockRedisFn, '__mockInstance', { value: instance });
  
  return {
    __esModule: true,
    default: MockRedisFn,
    Redis: MockRedisFn
  };
});

// Retrieve the mocked instance so tests can access `ping`
const MockRedis = IORedis as unknown as jest.Mock;
const mockInstance = (MockRedis as unknown as { __mockInstance: Pick<Redis, 'ping'> }).__mockInstance;

// Actually spy on the instance method!
jest.spyOn(mockInstance, 'ping');

describe('Redis client singleton', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('creates a single Redis instance with retry strategy and timeout', () => {
    const client1 = createRedisClient();
    const client2 = createRedisClient();

    expect(client1).toBe(client2);
    expect(MockRedis).toHaveBeenCalledTimes(1);

    const [url, options] = MockRedis.mock.calls[0];

    expect(url).toBe('redis://localhost:6379');
    expect(options.connectTimeout).toBe(5_000);
    expect(options.maxRetriesPerRequest).toBe(5);
    expect(typeof options.retryStrategy).toBe('function');

    // Basic check that retryStrategy returns a bounded delay
    const delaySmall = options.retryStrategy(1);
    const delayLarge = options.retryStrategy(100);
    expect(delaySmall).toBeGreaterThan(0);
    expect(delayLarge).toBeLessThanOrEqual(5_000);
  });
});

describe('Redis healthCheck', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (mockInstance.ping as jest.Mock).mockReset();
  });

  it('returns true when PING succeeds with PONG', async () => {
    (mockInstance.ping as jest.Mock).mockResolvedValueOnce('PONG');

    const result = await healthCheck();

    expect(result).toBe(true);
    expect(mockInstance.ping).toHaveBeenCalledTimes(1);
  });

  it('returns false when PING throws', async () => {
    (mockInstance.ping as jest.Mock).mockRejectedValueOnce(new Error('Redis down'));

    const result = await healthCheck();

    expect(result).toBe(false);
    expect(mockInstance.ping).toHaveBeenCalledTimes(1);
  });
});
