import type { RateLimitRequest, RateLimitResult, RuleConfig } from '@rateforge/types';

const RATE_LIMITER_URL = process.env['RATE_LIMITER_URL'] ?? 'http://localhost:3000';

const DEFAULT_TIMEOUT = 3000;

/**
 * Generic HTTP helper with timeout + safe JSON parsing
 */
async function httpRequest<T>(path: string, options: RequestInit = {}, fallback: T): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT);

  try {
    const response = await fetch(`${RATE_LIMITER_URL}${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {}),
      },
      signal: controller.signal,
    });

    if (!response.ok) return fallback;

    try {
      return (await response.json()) as T;
    } catch {
      return fallback;
    }
  } catch {
    return fallback;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Rate limit check (fail-open)
 */
export async function checkLimit(req: RateLimitRequest): Promise<RateLimitResult> {
  const fallback: RateLimitResult = {
    allowed: true,
    limit: Infinity,
    remaining: Infinity,
    resetAt: Date.now() + 60_000,
    reason: 'FALLBACK',
  };

  return httpRequest<RateLimitResult>(
    '/api/v1/check',
    {
      method: 'POST',
      body: JSON.stringify(req),
    },
    fallback,
  );
}

/**
 * Reset limit for a client
 */
export async function resetLimit(clientId: string): Promise<number> {
  const data = await httpRequest<{ data?: { deletedKeys?: number } }>(
    `/api/v1/reset/${clientId}`,
    { method: 'POST' },
    { data: { deletedKeys: 0 } },
  );

  return typeof data?.data?.deletedKeys === 'number' ? data.data.deletedKeys : 0;
}

/**
 * Fetch rules
 */
export async function getRules(): Promise<RuleConfig[]> {
  const data = await httpRequest<{ data?: RuleConfig[] }>('/api/v1/rules', {}, { data: [] });

  return data.data ?? [];
}

/**
 * No-op (in-process compatibility)
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function setRules(_rules: RuleConfig[]): void {
  // no-op
}

/**
 * Blacklist / Whitelist APIs
 */
export async function addToBlacklist(ip: string): Promise<void> {
  await httpRequest(
    '/api/v1/blacklist',
    {
      method: 'POST',
      body: JSON.stringify({ ip }),
    },
    null,
  );
}

export async function addToWhitelist(ip: string): Promise<void> {
  await httpRequest(
    '/api/v1/whitelist',
    {
      method: 'POST',
      body: JSON.stringify({ ip }),
    },
    null,
  );
}

/**
 * Check blacklist
 */
export async function isBlacklisted(ip: string): Promise<boolean> {
  const data = await httpRequest<{ blacklisted?: boolean }>(
    `/api/v1/blacklist/check?ip=${encodeURIComponent(ip)}`,
    {},
    { blacklisted: false },
  );

  return data.blacklisted === true;
}

/**
 * Check whitelist
 */
export async function isWhitelisted(ip: string): Promise<boolean> {
  const data = await httpRequest<{ whitelisted?: boolean }>(
    `/api/v1/whitelist/check?ip=${encodeURIComponent(ip)}`,
    {},
    { whitelisted: false },
  );

  return data.whitelisted === true;
}
