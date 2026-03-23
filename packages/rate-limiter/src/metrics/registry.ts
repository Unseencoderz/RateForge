import { Counter, Gauge, Histogram, Registry } from 'prom-client';

import type { Request } from 'express';

const SERVICE_NAME = 'rate-limiter';
const EXCLUDED_METRIC_PATHS = new Set(['/metrics', '/health', '/ready']);

export const metricsRegistry = new Registry();

export const httpRequestsTotal = new Counter({
  name: 'rateforge_http_requests_total',
  help: 'Total HTTP requests handled by RateForge services.',
  labelNames: ['service', 'method', 'route', 'status_code'] as const,
  registers: [metricsRegistry],
});

export const blockedRequestsTotal = new Counter({
  name: 'rateforge_blocked_requests_total',
  help: 'Total blocked requests produced by rate limiting or policy decisions.',
  labelNames: ['service', 'method', 'route', 'reason', 'rule_id'] as const,
  registers: [metricsRegistry],
});

export const requestDurationMs = new Histogram({
  name: 'rateforge_request_duration_ms',
  help: 'HTTP request duration in milliseconds.',
  labelNames: ['service', 'method', 'route'] as const,
  buckets: [5, 10, 25, 50, 100, 250, 500, 1_000, 2_500, 5_000],
  registers: [metricsRegistry],
});

export const redisErrors = new Gauge({
  name: 'rateforge_redis_errors',
  help: 'Redis error state per operation (0 = healthy, 1 = unhealthy).',
  labelNames: ['service', 'operation'] as const,
  registers: [metricsRegistry],
});

export function getMetricRoute(req: Request): string {
  const routePath =
    typeof req.route?.path === 'string'
      ? `${req.baseUrl}${req.route.path}`
      : `${req.baseUrl}${req.path}` || req.originalUrl;

  return routePath.split('?')[0] || '/';
}

export function shouldTrackRequestMetrics(req: Request): boolean {
  return !EXCLUDED_METRIC_PATHS.has(getMetricRoute(req));
}

export function recordHttpRequest(req: Request, statusCode: number, durationMs: number): void {
  if (!shouldTrackRequestMetrics(req)) {
    return;
  }

  const route = getMetricRoute(req);
  const labels = {
    service: SERVICE_NAME,
    method: req.method,
    route,
  };

  httpRequestsTotal.inc({
    ...labels,
    status_code: String(statusCode),
  });
  requestDurationMs.observe(labels, durationMs);
}

export function recordBlockedRequest(
  req: Request,
  reason: string | undefined,
  ruleId: string | undefined,
): void {
  if (!shouldTrackRequestMetrics(req)) {
    return;
  }

  blockedRequestsTotal.inc({
    service: SERVICE_NAME,
    method: req.method,
    route: getMetricRoute(req),
    reason: reason ?? 'UNKNOWN',
    rule_id: ruleId ?? 'none',
  });
}

export function markRedisHealthy(operation: string): void {
  redisErrors.set({ service: SERVICE_NAME, operation }, 0);
}

export function markRedisError(operation: string): void {
  redisErrors.set({ service: SERVICE_NAME, operation }, 1);
}

export function resetMetrics(): void {
  metricsRegistry.resetMetrics();
}
