import { jest } from '@jest/globals';

import { startAlertEvaluator, buildBlockedTrafficAlert, evaluateBlockedTraffic } from './evaluator';
import {
  blockedRequestsTotal,
  httpRequestsTotal,
  metricsRegistry,
  resetMetrics,
} from '../metrics/registry';

import type { AlertPayload } from '@rateforge/types';

describe('alert evaluator', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    resetMetrics();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('returns zeroed metrics when no traffic has been observed', async () => {
    const result = await evaluateBlockedTraffic();

    expect(result.totalRequests).toBe(0);
    expect(result.blockedRequests).toBe(0);
    expect(result.blockedRatio).toBe(0);
  });

  it('builds no alert when blocked ratio is at or below the threshold', () => {
    const payload = buildBlockedTrafficAlert({
      totalRequests: 10,
      blockedRequests: 2,
      blockedRatio: 0.2,
    });

    expect(payload).toBeNull();
  });

  it('builds a warning alert when blocked ratio exceeds the threshold', () => {
    const payload = buildBlockedTrafficAlert({
      totalRequests: 10,
      blockedRequests: 3,
      blockedRatio: 0.3,
    });

    expect(payload?.severity).toBe('warning');
    expect(payload?.metadata).toMatchObject({
      blockedRequests: 3,
      totalRequests: 10,
      blockedRatio: 0.3,
    });
  });

  it('builds a critical alert when blocked ratio is extremely high', () => {
    const payload = buildBlockedTrafficAlert({
      totalRequests: 10,
      blockedRequests: 6,
      blockedRatio: 0.6,
    });

    expect(payload?.severity).toBe('critical');
  });

  it('evaluates live registry counters and emits an alert when threshold is exceeded', async () => {
    httpRequestsTotal.inc(
      { service: 'rate-limiter', method: 'POST', route: '/api/v1/check', status_code: '200' },
      10,
    );
    blockedRequestsTotal.inc(
      {
        service: 'rate-limiter',
        method: 'POST',
        route: '/api/v1/check',
        reason: 'TOKEN_BUCKET_EXHAUSTED',
        rule_id: 'tight',
      },
      3,
    );

    const emitAlert = jest.fn<(_: AlertPayload) => Promise<void>>().mockResolvedValue(undefined);
    const handle = startAlertEvaluator({
      emitAlert,
      intervalMs: 60_000,
      registry: metricsRegistry,
    });

    const payload = await handle.evaluate();

    expect(payload).not.toBeNull();
    expect(emitAlert).toHaveBeenCalledTimes(1);
    expect(emitAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        severity: 'warning',
      }),
    );

    await handle.stop();
  });

  it('does not emit an alert when the threshold has not been exceeded', async () => {
    httpRequestsTotal.inc(
      { service: 'rate-limiter', method: 'POST', route: '/api/v1/check', status_code: '200' },
      10,
    );
    blockedRequestsTotal.inc(
      {
        service: 'rate-limiter',
        method: 'POST',
        route: '/api/v1/check',
        reason: 'TOKEN_BUCKET_EXHAUSTED',
        rule_id: 'tight',
      },
      2,
    );

    const emitAlert = jest.fn<(_: AlertPayload) => Promise<void>>().mockResolvedValue(undefined);
    const handle = startAlertEvaluator({
      emitAlert,
      intervalMs: 60_000,
      registry: metricsRegistry,
    });

    const payload = await handle.evaluate();

    expect(payload).toBeNull();
    expect(emitAlert).not.toHaveBeenCalled();

    await handle.stop();
  });

  it('runs on the configured interval until stopped', async () => {
    httpRequestsTotal.inc(
      { service: 'rate-limiter', method: 'POST', route: '/api/v1/check', status_code: '200' },
      10,
    );
    blockedRequestsTotal.inc(
      {
        service: 'rate-limiter',
        method: 'POST',
        route: '/api/v1/check',
        reason: 'BLACKLISTED',
        rule_id: 'policy',
      },
      4,
    );

    const emitAlert = jest.fn<(_: AlertPayload) => Promise<void>>().mockResolvedValue(undefined);
    const handle = startAlertEvaluator({
      emitAlert,
      intervalMs: 5_000,
      registry: metricsRegistry,
    });

    await jest.advanceTimersByTimeAsync(5_000);
    await jest.advanceTimersByTimeAsync(5_000);

    expect(emitAlert).toHaveBeenCalledTimes(2);

    await handle.stop();

    await jest.advanceTimersByTimeAsync(5_000);
    expect(emitAlert).toHaveBeenCalledTimes(2);
  });
});
