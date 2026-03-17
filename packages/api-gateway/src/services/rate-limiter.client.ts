import type { RateLimitRequest, RateLimitResult, RuleConfig } from '@rateforge/types';

const RATE_LIMITER_URL = process.env['RATE_LIMITER_URL'] ?? 'http://localhost:3001';

export async function checkLimit(req: RateLimitRequest): Promise<RateLimitResult> {
  const response = await fetch(`${RATE_LIMITER_URL}/api/v1/check`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  });

  if (!response.ok) {
    // fail-open: if rate-limiter is down, allow the request
    return {
      allowed: true,
      limit: Infinity,
      remaining: Infinity,
      resetAt: Date.now() + 60_000,
      reason: 'FALLBACK'
    };
  }

  return response.json() as Promise<RateLimitResult>;
}

export async function resetLimit(clientId: string): Promise<number> {
  const response = await fetch(`${RATE_LIMITER_URL}/api/v1/reset/${clientId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });
  if (!response.ok) return 0;

  try {
    const data = await response.json() as { data?: { deletedKeys?: number } };
    return typeof data?.data?.deletedKeys === 'number' ? data.data.deletedKeys : 1;
  } catch {
    return 1;
  }
}

export async function getRules(): Promise<RuleConfig[]> {
  const response = await fetch(`${RATE_LIMITER_URL}/api/v1/rules`);
  const data = await response.json() as { data?: RuleConfig[] };
  return data?.data ?? [];
}

/**
 * Synchronous in-process setRules placeholder.
 *
 * The api-gateway's rate-limit middleware calls RateLimitService directly
 * (same process) rather than via HTTP, so setRules() here is a no-op shim
 * used by app.ts startup until a local RateLimitService is wired.
 *
 * When the rate-limiter runs as a separate service this client delegates
 * over HTTP and this function is unused — hence the eslint disable.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function setRules(_rules: RuleConfig[]): void {
  // no-op: rule state lives in the rate-limiter process
}
