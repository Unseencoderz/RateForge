
const path = require('path');

/** @type {import('jest').Config} */
const config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: process.cwd(),
  // Restrict Jest to only look for tests in the specific workspace package calling it
  testMatch: ['<rootDir>/src/**/*.test.ts'],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
  setupFiles: [path.resolve(__dirname, 'jest.setup.env.js')],
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
  collectCoverage: false,          // keep false for normal runs; CI passes --coverage flag
  coverageThreshold: {
    global: {
      branches:   80,
      functions:  80,
      lines:      80,
      statements: 80
    }
  },
  coveragePathIgnorePatterns: [
    '/node_modules/',
    '/dist/'
  ],
  transform: {
    '^.+\\.tsx?$': ['ts-jest', {
      tsconfig: { esModuleInterop: true, strict: true },   // was strict: false
    }],
  },
};

module.exports = config;