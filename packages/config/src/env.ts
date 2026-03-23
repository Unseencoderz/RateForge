import { resolve } from 'path';

import { config } from 'dotenv';
import { z } from 'zod';

// This tells it to look 3 folders up to find the root .env file!
config({ path: resolve(__dirname, '../../../.env') });

const envSchema = z.object({
  REDIS_URL: z.string().url(),
  RATE_LIMITER_URL: z.string().url().default('http://localhost:3001'),
  PORT: z
    .string()
    .regex(/^\d+$/)
    .transform((val) => parseInt(val, 10)),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  JWT_SECRET: z.string().min(1),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  // Fail fast on invalid configuration
  console.error('Invalid environment configuration', parsed.error.flatten());
  process.exit(1);
}

if (
  parsed.data.NODE_ENV === 'production' &&
  ['change-me-in-production', 'change-me-in-production-in-production', 'test-secret'].includes(
    parsed.data.JWT_SECRET,
  )
) {
  console.error(
    'Invalid production configuration: JWT_SECRET must be replaced with a real secret.',
  );
  process.exit(1);
}

export const REDIS_URL = parsed.data.REDIS_URL;
export const RATE_LIMITER_URL = parsed.data.RATE_LIMITER_URL;
export const PORT = parsed.data.PORT;
export const NODE_ENV = parsed.data.NODE_ENV;
export const LOG_LEVEL = parsed.data.LOG_LEVEL;
export const JWT_SECRET = parsed.data.JWT_SECRET;
