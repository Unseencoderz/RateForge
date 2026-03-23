import { randomUUID } from 'crypto';

import { metricsRegistry } from '../metrics/registry';
import { getErrorMeta, logger } from '../utils/logger';

import { sendWebhookAlert } from './sinks/webhook';

import type { AlertPayload } from '@rateforge/types';
import type { Registry } from 'prom-client';

interface MetricValueSnapshot {
  labels?: Record<string, string>;
  value: number;
}

interface MetricSnapshot {
  name: string;
  values?: MetricValueSnapshot[];
}

export interface AlertEvaluationResult {
  blockedRatio: number;
  blockedRequests: number;
  totalRequests: number;
}

export interface AlertEvaluatorOptions {
  emitAlert?: (payload: AlertPayload) => Promise<void>;
  intervalMs?: number;
  registry?: Registry;
  threshold?: number;
}

export interface AlertEvaluatorHandle {
  evaluate: () => Promise<AlertPayload | null>;
  stop: () => Promise<void>;
}

const ALERT_INTERVAL_MS = 60_000;
const BLOCKED_RATIO_THRESHOLD = 0.2;
const SERVICE_NAME = 'rate-limiter';
const HTTP_REQUESTS_TOTAL_METRIC_NAME = 'rateforge_http_requests_total';
const BLOCKED_REQUESTS_TOTAL_METRIC_NAME = 'rateforge_blocked_requests_total';

function sumCounterValues(metrics: MetricSnapshot[], metricName: string): number {
  return (
    metrics
      .find((metric) => metric.name === metricName)
      ?.values?.filter((value) => value.labels?.['service'] === SERVICE_NAME)
      .reduce((sum, value) => sum + value.value, 0) ?? 0
  );
}

export async function evaluateBlockedTraffic(
  registry: Registry = metricsRegistry,
): Promise<AlertEvaluationResult> {
  const metrics = (await registry.getMetricsAsJSON()) as MetricSnapshot[];

  const totalRequests = sumCounterValues(metrics, HTTP_REQUESTS_TOTAL_METRIC_NAME);
  const blockedRequests = sumCounterValues(metrics, BLOCKED_REQUESTS_TOTAL_METRIC_NAME);

  return {
    totalRequests,
    blockedRequests,
    blockedRatio: totalRequests > 0 ? blockedRequests / totalRequests : 0,
  };
}

export function buildBlockedTrafficAlert(
  result: AlertEvaluationResult,
  threshold: number = BLOCKED_RATIO_THRESHOLD,
): AlertPayload | null {
  if (result.totalRequests <= 0 || result.blockedRatio <= threshold) {
    return null;
  }

  const blockedRatioPercent = Number((result.blockedRatio * 100).toFixed(2));
  const thresholdPercent = Number((threshold * 100).toFixed(2));

  return {
    id: randomUUID(),
    createdAt: Date.now(),
    severity: result.blockedRatio >= 0.5 ? 'critical' : 'warning',
    message:
      `Blocked traffic ratio reached ${blockedRatioPercent}% ` +
      `(${result.blockedRequests}/${result.totalRequests}) and exceeded the ${thresholdPercent}% threshold.`,
    metadata: {
      service: SERVICE_NAME,
      blockedRequests: result.blockedRequests,
      totalRequests: result.totalRequests,
      blockedRatio: Number(result.blockedRatio.toFixed(4)),
      threshold: Number(threshold.toFixed(4)),
    },
  };
}

export function startAlertEvaluator(options: AlertEvaluatorOptions = {}): AlertEvaluatorHandle {
  const emitAlert = options.emitAlert ?? sendWebhookAlert;
  const registry = options.registry ?? metricsRegistry;
  const intervalMs = options.intervalMs ?? ALERT_INTERVAL_MS;
  const threshold = options.threshold ?? BLOCKED_RATIO_THRESHOLD;

  const evaluate = async (): Promise<AlertPayload | null> => {
    try {
      const result = await evaluateBlockedTraffic(registry);
      const payload = buildBlockedTrafficAlert(result, threshold);

      if (!payload) {
        logger.debug({
          message: 'Alert evaluation completed below threshold',
          event: 'alert.evaluation.skipped',
          blockedRequests: result.blockedRequests,
          totalRequests: result.totalRequests,
          blockedRatio: Number(result.blockedRatio.toFixed(4)),
          threshold: Number(threshold.toFixed(4)),
        });
        return null;
      }

      logger.warn({
        message: 'Blocked traffic threshold exceeded',
        event: 'alert.threshold_exceeded',
        alertId: payload.id,
        severity: payload.severity,
        ...(payload.metadata ?? {}),
      });
      await emitAlert(payload);
      return payload;
    } catch (error) {
      logger.error({
        message: 'Alert evaluation failed',
        event: 'alert.evaluation_failed',
        ...getErrorMeta(error),
      });
      return null;
    }
  };

  const timer = setInterval(() => {
    void evaluate();
  }, intervalMs);
  timer.unref();

  logger.info({
    message: 'Alert evaluator started',
    event: 'alert.evaluator_started',
    intervalMs,
    threshold,
  });

  return {
    evaluate,
    stop: async () => {
      clearInterval(timer);
      logger.info({
        message: 'Alert evaluator stopped',
        event: 'alert.evaluator_stopped',
      });
    },
  };
}
