import { normaliseGatewayUrl } from '../lib/settings';

export interface MetricPoint {
  label: string;
  timestamp: number;
  value: number;
}

export interface TopBlockedClient {
  blockedRequests: number;
  clientIp: string;
}

export interface MetricSnapshot {
  allowedRequests: number;
  blockedRatio: number;
  blockedRequests: number;
  fetchedAt: number;
  latencyMs: {
    p50: number;
    p95: number;
    p99: number;
  };
  requestsPerSecond: number;
  requestsPerSecondSeries: MetricPoint[];
  topBlockedClients: TopBlockedClient[];
  totalRequests: number;
}

export interface MetricsSubscriptionHandle {
  refresh: () => Promise<void>;
  stop: () => void;
}

interface MetricEntry {
  labels: Record<string, string>;
  name: string;
  value: number;
}

interface RawMetricSnapshot {
  blockedRequests: number;
  fetchedAt: number;
  latencyMs: {
    p50: number;
    p95: number;
    p99: number;
  };
  topBlockedClients: TopBlockedClient[];
  totalRequests: number;
}

interface HistogramBucket {
  count: number;
  upperBound: number;
}

const DASHBOARD_SERVICE = 'api-gateway';
const HISTORY_LIMIT = 12;
const METRICS_POLL_INTERVAL_MS = 5_000;

function parsePrometheusValue(value: string): number {
  if (value === '+Inf' || value === 'Inf') {
    return Number.POSITIVE_INFINITY;
  }

  if (value === '-Inf') {
    return Number.NEGATIVE_INFINITY;
  }

  if (value === 'NaN') {
    return Number.NaN;
  }

  return Number(value);
}

function parseLabels(rawLabels: string | undefined): Record<string, string> {
  if (!rawLabels) {
    return {};
  }

  return rawLabels
    .split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/)
    .reduce<Record<string, string>>((accumulator, pair) => {
      const [rawKey, rawValue] = pair.split('=');
      if (!rawKey || rawValue === undefined) {
        return accumulator;
      }

      accumulator[rawKey.trim()] = rawValue.trim().replace(/^"|"$/g, '').replace(/\\"/g, '"');
      return accumulator;
    }, {});
}

function parseMetricEntries(metricsText: string): MetricEntry[] {
  return metricsText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'))
    .map((line) => {
      const match = line.match(/^([a-zA-Z_:][a-zA-Z0-9_:]*)(?:\{([^}]*)\})?\s+(.+)$/);
      if (!match) {
        return null;
      }

      return {
        name: match[1],
        labels: parseLabels(match[2]),
        value: parsePrometheusValue(match[3]),
      } satisfies MetricEntry;
    })
    .filter((entry): entry is MetricEntry => entry !== null);
}

function formatSeriesLabel(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(timestamp);
}

function sumMetric(entries: MetricEntry[], metricName: string): number {
  return entries
    .filter((entry) => entry.name === metricName && entry.labels['service'] === DASHBOARD_SERVICE)
    .reduce((sum, entry) => sum + entry.value, 0);
}

function getTopBlockedClients(entries: MetricEntry[]): TopBlockedClient[] {
  return entries
    .filter(
      (entry) =>
        entry.name === 'rateforge_blocked_client_requests_total' &&
        entry.labels['service'] === DASHBOARD_SERVICE,
    )
    .map((entry) => ({
      clientIp: entry.labels['client_ip'] ?? 'unknown',
      blockedRequests: entry.value,
    }))
    .sort((left, right) => right.blockedRequests - left.blockedRequests)
    .slice(0, 10);
}

function buildHistogramBuckets(entries: MetricEntry[]): HistogramBucket[] {
  return Array.from(
    entries
      .filter(
        (entry) =>
          entry.name === 'rateforge_request_duration_ms_bucket' &&
          entry.labels['service'] === DASHBOARD_SERVICE,
      )
      .reduce<Map<number, number>>((bucketMap, entry) => {
        const upperBound = parsePrometheusValue(entry.labels['le'] ?? 'NaN');
        if (Number.isNaN(upperBound)) {
          return bucketMap;
        }

        bucketMap.set(upperBound, (bucketMap.get(upperBound) ?? 0) + entry.value);
        return bucketMap;
      }, new Map<number, number>()),
  )
    .map(([upperBound, count]) => ({
      upperBound,
      count,
    }))
    .sort((left, right) => left.upperBound - right.upperBound);
}

function estimateQuantile(buckets: HistogramBucket[], quantile: number): number {
  if (buckets.length === 0) {
    return 0;
  }

  const total = buckets[buckets.length - 1]?.count ?? 0;
  if (total <= 0) {
    return 0;
  }

  const target = total * quantile;
  let previousCount = 0;
  let previousUpperBound = 0;

  for (const bucket of buckets) {
    if (bucket.count < target) {
      previousCount = bucket.count;
      previousUpperBound = Number.isFinite(bucket.upperBound)
        ? bucket.upperBound
        : previousUpperBound;
      continue;
    }

    if (!Number.isFinite(bucket.upperBound)) {
      return Number(previousUpperBound.toFixed(2));
    }

    const bucketSpan = bucket.upperBound - previousUpperBound;
    const bucketCount = bucket.count - previousCount;
    if (bucketCount <= 0 || bucketSpan <= 0) {
      return Number(bucket.upperBound.toFixed(2));
    }

    const fraction = (target - previousCount) / bucketCount;
    return Number((previousUpperBound + bucketSpan * fraction).toFixed(2));
  }

  return Number(previousUpperBound.toFixed(2));
}

function parseMetricsSnapshot(metricsText: string): RawMetricSnapshot {
  const entries = parseMetricEntries(metricsText);
  const totalRequests = sumMetric(entries, 'rateforge_http_requests_total');
  const blockedRequests = sumMetric(entries, 'rateforge_blocked_requests_total');
  const latencyBuckets = buildHistogramBuckets(entries);

  return {
    fetchedAt: Date.now(),
    totalRequests,
    blockedRequests,
    latencyMs: {
      p50: estimateQuantile(latencyBuckets, 0.5),
      p95: estimateQuantile(latencyBuckets, 0.95),
      p99: estimateQuantile(latencyBuckets, 0.99),
    },
    topBlockedClients: getTopBlockedClients(entries),
  };
}

async function readMetricsBody(gatewayUrl: string): Promise<string> {
  const response = await fetch(`${normaliseGatewayUrl(gatewayUrl)}/metrics`, {
    headers: {
      Accept: 'text/plain',
    },
  });

  const body = await response.text();
  if (!response.ok) {
    throw new Error(body || `Metrics request failed with HTTP ${response.status}.`);
  }

  return body;
}

export async function fetchMetrics(gatewayUrl: string): Promise<RawMetricSnapshot> {
  if (!gatewayUrl.trim()) {
    throw new Error('Save a gateway URL before loading metrics.');
  }

  return parseMetricsSnapshot(await readMetricsBody(gatewayUrl));
}

export function subscribeToMetrics(
  gatewayUrl: string,
  onSnapshot: (snapshot: MetricSnapshot) => void,
  onError: (message: string) => void,
  intervalMs: number = METRICS_POLL_INTERVAL_MS,
): MetricsSubscriptionHandle {
  let active = true;
  let timerId: number | null = null;
  let previousSnapshot: RawMetricSnapshot | null = null;
  let requestsPerSecondSeries: MetricPoint[] = [];

  const poll = async (): Promise<void> => {
    try {
      const rawSnapshot = await fetchMetrics(gatewayUrl);
      if (!active) {
        return;
      }

      const elapsedSeconds = previousSnapshot
        ? Math.max(1, (rawSnapshot.fetchedAt - previousSnapshot.fetchedAt) / 1_000)
        : intervalMs / 1_000;
      const requestDelta = previousSnapshot
        ? Math.max(0, rawSnapshot.totalRequests - previousSnapshot.totalRequests)
        : 0;
      const requestsPerSecond = Number((requestDelta / elapsedSeconds).toFixed(2));

      requestsPerSecondSeries = [
        ...requestsPerSecondSeries,
        {
          timestamp: rawSnapshot.fetchedAt,
          label: formatSeriesLabel(rawSnapshot.fetchedAt),
          value: requestsPerSecond,
        },
      ].slice(-HISTORY_LIMIT);

      previousSnapshot = rawSnapshot;

      onSnapshot({
        fetchedAt: rawSnapshot.fetchedAt,
        totalRequests: rawSnapshot.totalRequests,
        blockedRequests: rawSnapshot.blockedRequests,
        allowedRequests: Math.max(0, rawSnapshot.totalRequests - rawSnapshot.blockedRequests),
        blockedRatio:
          rawSnapshot.totalRequests > 0
            ? Number((rawSnapshot.blockedRequests / rawSnapshot.totalRequests).toFixed(4))
            : 0,
        requestsPerSecond,
        requestsPerSecondSeries,
        latencyMs: rawSnapshot.latencyMs,
        topBlockedClients: rawSnapshot.topBlockedClients,
      });
      onError('');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load metrics.';
      if (active) {
        onError(message);
      }
    }
  };

  void poll();
  timerId = window.setInterval(() => {
    void poll();
  }, intervalMs);

  return {
    refresh: poll,
    stop: () => {
      active = false;
      if (timerId !== null) {
        window.clearInterval(timerId);
      }
    },
  };
}
