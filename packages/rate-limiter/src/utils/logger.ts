import { LOG_LEVEL, NODE_ENV } from '@rateforge/config';
import { createLogger as createWinstonLogger, format, transports } from 'winston';

import { getRequestContext } from './request-context';

import type { Request } from 'express';
import type { Logger } from 'winston';

function serialiseMeta(meta: Record<string, unknown>): string {
  const filtered = Object.entries(meta).filter(([, value]) => value !== undefined);
  if (filtered.length === 0) {
    return '';
  }

  return ` ${JSON.stringify(Object.fromEntries(filtered))}`;
}

export function getErrorMeta(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return {
      errorName: error.name,
      errorMessage: error.message,
      errorStack: error.stack,
    };
  }

  return {
    errorMessage: typeof error === 'string' ? error : 'Unknown error',
    errorValue: error,
  };
}

interface LogLineInfo extends Record<string, unknown> {
  timestamp?: string;
  level: string;
  message: string;
}

const runtimeNodeEnv = NODE_ENV ?? process.env['NODE_ENV'] ?? 'development';
const runtimeLogLevel = LOG_LEVEL ?? process.env['LOG_LEVEL'] ?? 'info';
const isTestEnv = runtimeNodeEnv === 'test' || Boolean(process.env['JEST_WORKER_ID']);

export const logger = createWinstonLogger({
  level: runtimeLogLevel,
  silent: isTestEnv,
  defaultMeta: {
    service: 'rate-limiter',
    environment: runtimeNodeEnv,
  },
  format:
    runtimeNodeEnv === 'production'
      ? format.combine(format.timestamp(), format.json())
      : format.combine(
          format.colorize({ all: true }),
          format.timestamp(),
          format.printf((info) => {
            const { timestamp, level, message, ...meta } = info as LogLineInfo;
            return `${timestamp} ${level} ${message}${serialiseMeta(meta)}`;
          }),
        ),
  transports: [new transports.Console()],
});

export function getRequestLogger(req?: Request): Logger {
  const requestId = req?.id ?? getRequestContext()?.requestId;
  const traceId = req?.traceId ?? getRequestContext()?.traceId ?? requestId;

  if (!requestId && !traceId) {
    return logger;
  }

  return logger.child({
    requestId,
    traceId,
  });
}
