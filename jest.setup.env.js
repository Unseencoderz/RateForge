// Set required environment variables for tests to prevent @rateforge/config from throwing validation errors
process.env.REDIS_URL = 'redis://localhost:6379';
process.env.PORT = '3000';
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'error'; // keep test output clean
process.env.JWT_SECRET = 'test-secret';
