import type { JestConfigWithTsJest } from 'ts-jest';

const config: JestConfigWithTsJest = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
  moduleNameMapper: {
    '^@rateforge/types/(.*)$': '<rootDir>/packages/types/src/$1',
    '^@rateforge/config/(.*)$': '<rootDir>/packages/config/src/$1',
    '^@rateforge/api-gateway/(.*)$': '<rootDir>/packages/api-gateway/src/$1',
    '^@rateforge/rate-limiter/(.*)$': '<rootDir>/packages/rate-limiter/src/$1',
    '^@rateforge/dashboard/(.*)$': '<rootDir>/packages/dashboard/src/$1'
  },
  collectCoverage: true,
  collectCoverageFrom: ['**/*.{ts,tsx}', '!**/dist/**', '!**/node_modules/**'],
  coverageDirectory: '<rootDir>/coverage',
  coverageThreshold: {
    global: {
      branches: 80,
      functions: 80,
      lines: 80,
      statements: 80
    }
  }
};

export default config;

