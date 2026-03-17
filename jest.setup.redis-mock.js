// Global Jest setup for Redis mocking
//
// Ensures that any test which forgets to mock `ioredis` explicitly will use
// `ioredis-mock` instead of attempting a real TCP connection to Redis.
//
// Test files that need a custom Redis mock can still call `jest.mock('ioredis', ...)`
// and will override this default.

// eslint-disable-next-line @typescript-eslint/no-var-requires
const IORedisMock = require('ioredis-mock');

jest.mock('ioredis', () => {
  const MockRedis = jest.fn().mockImplementation((...args) => new IORedisMock(...args));

  // Expose the underlying mock class API if needed by tests
  Object.assign(MockRedis, IORedisMock);

  return {
    __esModule: true,
    default: MockRedis
  };
});

