import { JWT_SECRET, RATE_LIMITER_URL } from '@rateforge/config';

import { createInternalServiceHeaders } from '../utils/internal-service-auth';
import { getRequestContext } from '../utils/request-context';

import type { RateLimitRequest, RateLimitResult, RuleConfig } from '@rateforge/types';

const DEFAULT_TIMEOUT_MS = 3_000;
const INTERNAL_SERVICE_NAME = 'api-gateway';

interface JsonRequestOptions<T> {
  body?: string;
  fallback?: T;
  headers?: Record<string, string>;
  method?: 'GET' | 'POST' | 'PUT';
  timeoutMs?: number;
}

function buildInternalHeaders(
  method: string,
  path: string,
  body?: string,
  headers: Record<string, string> = {},
): Record<string, string> {
  const requestContext = getRequestContext();

  void body;
  return {
    ...headers,
    ...(requestContext?.requestId ? { 'X-Request-ID': requestContext.requestId } : {}),
    ...(requestContext?.traceId ? { 'X-Trace-ID': requestContext.traceId } : {}),
    ...createInternalServiceHeaders({
      service: INTERNAL_SERVICE_NAME,
      method,
      path,
      secret: JWT_SECRET,
    }),
  };
}

async function requestJson<T>(path: string, options: JsonRequestOptions<T> = {}): Promise<T> {
  const method = options.method ?? 'GET';
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  try {
    const response = await fetch(`${RATE_LIMITER_URL}${path}`, {
      method,
      body: options.body,
      headers: buildInternalHeaders(method, path, options.body, {
        'Content-Type': 'application/json',
        ...(options.headers ?? {}),
      }),
      signal: controller.signal,
    });

    if (!response.ok && response.status !== 429) {
      if (options.fallback !== undefined) {
        return options.fallback;
      }

      const errorText = await response.text().catch(() => '');
      throw new Error(
        `Rate limiter request failed (${response.status} ${response.statusText})${errorText ? `: ${errorText}` : ''}`,
      );
    }

    return (await response.json()) as T;
  } catch (err) {
    if (options.fallback !== undefined) {
      return options.fallback;
    }

    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

export async function checkLimit(req: RateLimitRequest): Promise<RateLimitResult> {
  return requestJson<RateLimitResult>('/api/v1/check', {
    method: 'POST',
    body: JSON.stringify(req),
  });
}

export async function resetLimit(clientId: string): Promise<number> {
  const data = await requestJson<{ data?: { deletedKeys?: number } }>(`/api/v1/reset/${clientId}`, {
    method: 'POST',
  });

  return typeof data?.data?.deletedKeys === 'number' ? data.data.deletedKeys : 0;
}

export async function getRules(): Promise<RuleConfig[]> {
  const data = await requestJson<{ data?: RuleConfig[] }>('/api/v1/rules');
  return data.data ?? [];
}

export async function addToBlacklist(ip: string): Promise<void> {
  await requestJson('/api/v1/blacklist', {
    method: 'POST',
    body: JSON.stringify({ ip }),
  });
}

export async function addToWhitelist(ip: string): Promise<void> {
  await requestJson('/api/v1/whitelist', {
    method: 'POST',
    body: JSON.stringify({ ip }),
  });
}

export async function isBlacklisted(ip: string): Promise<boolean> {
  const data = await requestJson<{ blacklisted?: boolean }>(
    `/api/v1/blacklist/check?ip=${encodeURIComponent(ip)}`,
    {
      fallback: { blacklisted: false },
    },
  );

  return data.blacklisted === true;
}

export async function isWhitelisted(ip: string): Promise<boolean> {
  const data = await requestJson<{ whitelisted?: boolean }>(
    `/api/v1/whitelist/check?ip=${encodeURIComponent(ip)}`,
    {
      fallback: { whitelisted: false },
    },
  );

  return data.whitelisted === true;
}
