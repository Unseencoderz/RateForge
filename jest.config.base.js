
const path = require('path');

/** @type {import('jest').Config} */
const config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  // Restrict Jest to only look for tests in the specific workspace package calling it
  testMatch: ['**/src/**/*.test.ts'],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
  setupFilesAfterEnv: [path.resolve(__dirname, 'jest.setup.redis-mock.js')],
  moduleNameMapper: {
    // Map exact package imports directly to their entry points
    '^@rateforge/types$': path.resolve(__dirname, 'packages/types/src/index.ts'),
    '^@rateforge/config$': path.resolve(__dirname, 'packages/config/src/index.ts'),

    // Map deep imports
    '^@rateforge/types/(.*)$': path.resolve(__dirname, 'packages/types/src/$1'),
    '^@rateforge/config/(.*)$': path.resolve(__dirname, 'packages/config/src/$1'),
    
    // Map cross dependencies explicitly for jest resolution
    '^@rateforge/rate-limiter/(.*)$': path.resolve(__dirname, 'packages/rate-limiter/src/$1'),
  },
  passWithNoTests: true,
  collectCoverage: false,
  transform: {
    '^.+\\.tsx?$': ['ts-jest', {
      tsconfig: { esModuleInterop: true, strict: false },
    }],
  },
};

module.exports = config;