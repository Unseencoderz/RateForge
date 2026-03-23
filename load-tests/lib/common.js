import { check } from 'k6';
import exec from 'k6/execution';
import http from 'k6/http';
import { Counter, Rate, Trend } from 'k6/metrics';

const DEFAULT_BASE_URL = 'http://localhost:3000';
const DEFAULT_TARGET_PATH = '/api/v1/admin/rules';
const DEFAULT_TIMEOUT = '5s';
const SHARED_IP = '10.0.0.1';

export const gatewayRoundTripMs = new Trend('gateway_round_trip_ms', true);
export const blockedResponses = new Counter('blocked_responses');
export const successResponses = new Counter('success_responses');
export const status429Rate = new Rate('status_429_rate');
export const status5xxRate = new Rate('status_5xx_rate');
export const authErrorRate = new Rate('auth_error_rate');

function stripTrailingSlash(value) {
  return value.endsWith('/') ? value.slice(0, -1) : value;
}

function normalisePath(value) {
  if (!value || value === '/') {
    return '/';
  }

  return value.startsWith('/') ? value : `/${value}`;
}

function buildTestIp(seed) {
  const secondOctet = (seed % 250) + 1;
  const thirdOctet = (Math.floor(seed / 250) % 250) + 1;
  const fourthOctet = (Math.floor(seed / 62_500) % 250) + 1;

  return `10.${secondOctet}.${thirdOctet}.${fourthOctet}`;
}

function getTargetConfig() {
  const baseUrl = stripTrailingSlash(__ENV.RF_BASE_URL || DEFAULT_BASE_URL);
  const path = normalisePath(__ENV.RF_TARGET_PATH || DEFAULT_TARGET_PATH);
  const bearerToken = (__ENV.RF_BEARER_TOKEN || '').trim();
  const timeout = __ENV.RF_TIMEOUT || DEFAULT_TIMEOUT;

  if (path.startsWith('/api/v1/admin') && bearerToken.length === 0) {
    throw new Error('RF_BEARER_TOKEN is required when RF_TARGET_PATH points at an admin route.');
  }

  return {
    baseUrl,
    path,
    url: `${baseUrl}${path}`,
    bearerToken,
    timeout,
  };
}

const targetConfig = getTargetConfig();

export function resolveIpStrategy(defaultStrategy) {
  const configured = (__ENV.RF_IP_STRATEGY || defaultStrategy || 'distributed').trim();

  if (configured === 'shared' || configured === 'sticky' || configured === 'distributed') {
    return configured;
  }

  throw new Error(
    `Unsupported RF_IP_STRATEGY "${configured}". Use shared, sticky, or distributed.`,
  );
}

export function resolveSleepSeconds(defaultSeconds) {
  const raw = __ENV.RF_SLEEP_SECONDS;

  if (raw === undefined || raw === '') {
    return defaultSeconds;
  }

  const parsed = Number(raw);
  if (Number.isNaN(parsed) || parsed < 0) {
    throw new Error(`RF_SLEEP_SECONDS must be a non-negative number. Received "${raw}".`);
  }

  return parsed;
}

export function getSummaryMetadata() {
  return {
    baseUrl: targetConfig.baseUrl,
    path: targetConfig.path,
    timeout: targetConfig.timeout,
    bearerTokenConfigured: targetConfig.bearerToken.length > 0,
  };
}

export function getClientIp(ipStrategy) {
  if (ipStrategy === 'shared') {
    return SHARED_IP;
  }

  if (ipStrategy === 'sticky') {
    return buildTestIp(exec.vu.idInTest);
  }

  const seed = exec.vu.idInTest * 10_000 + exec.scenario.iterationInTest;
  return buildTestIp(seed);
}

function buildRequestHeaders(ipStrategy, extraHeaders) {
  const correlationId = `${exec.scenario.name}-${exec.vu.idInTest}-${exec.scenario.iterationInTest}`;

  return {
    Accept: 'application/json',
    ...(targetConfig.bearerToken ? { Authorization: `Bearer ${targetConfig.bearerToken}` } : {}),
    'X-Forwarded-For': getClientIp(ipStrategy),
    'X-Request-ID': correlationId,
    'X-Trace-ID': `${correlationId}-trace`,
    ...(extraHeaders || {}),
  };
}

export function createOptions(name, scenarioConfig, extraThresholds) {
  return {
    discardResponseBodies: true,
    summaryTrendStats: ['min', 'avg', 'med', 'max', 'p(90)', 'p(95)', 'p(99)'],
    thresholds: {
      auth_error_rate: ['rate==0'],
      status_5xx_rate: ['rate<0.02'],
      checks: ['rate>0.99'],
      ...(extraThresholds || {}),
    },
    scenarios: {
      [name]: {
        ...scenarioConfig,
      },
    },
  };
}

export function runGatewayRequest(options) {
  const requestOptions = options || {};
  const ipStrategy = requestOptions.ipStrategy || 'distributed';
  const method = requestOptions.method || 'GET';
  const tags = {
    scenario: exec.scenario.name,
    target_path: targetConfig.path,
    ip_strategy: ipStrategy,
    ...(requestOptions.tags || {}),
  };
  const params = {
    headers: buildRequestHeaders(ipStrategy, requestOptions.headers),
    tags,
    timeout: targetConfig.timeout,
  };
  const body = requestOptions.body === undefined ? null : requestOptions.body;
  const response =
    method === 'GET' && body === null
      ? http.get(targetConfig.url, params)
      : http.request(method, targetConfig.url, body, params);

  gatewayRoundTripMs.add(response.timings.duration, tags);
  status429Rate.add(response.status === 429 ? 1 : 0, tags);
  status5xxRate.add(response.status >= 500 ? 1 : 0, tags);
  authErrorRate.add(response.status === 401 || response.status === 403 ? 1 : 0, tags);

  if (response.status >= 200 && response.status < 300) {
    successResponses.add(1, tags);
  }

  if (response.status === 429) {
    blockedResponses.add(1, tags);
  }

  check(response, {
    'response is not an auth failure': (res) => res.status !== 401 && res.status !== 403,
    'response is not a server error': (res) => res.status < 500,
  });

  return response;
}

function getMetricValues(data, metricName) {
  const metric = data.metrics[metricName];
  return metric && metric.values ? metric.values : {};
}

function getMetricNumber(data, metricName, key) {
  const value = getMetricValues(data, metricName)[key];
  return typeof value === 'number' ? value : null;
}

function buildSummaryPayload(name, data, metadata) {
  return {
    scenario: name,
    generatedAt: new Date().toISOString(),
    target: getSummaryMetadata(),
    metadata: metadata || {},
    metrics: {
      iterations: getMetricNumber(data, 'iterations', 'count'),
      httpRequests: getMetricNumber(data, 'http_reqs', 'count'),
      checksRate: getMetricNumber(data, 'checks', 'rate'),
      blockedResponses: getMetricNumber(data, 'blocked_responses', 'count'),
      successResponses: getMetricNumber(data, 'success_responses', 'count'),
      authErrorRate: getMetricNumber(data, 'auth_error_rate', 'rate'),
      status429Rate: getMetricNumber(data, 'status_429_rate', 'rate'),
      status5xxRate: getMetricNumber(data, 'status_5xx_rate', 'rate'),
      httpReqDurationMs: {
        min: getMetricNumber(data, 'http_req_duration', 'min'),
        avg: getMetricNumber(data, 'http_req_duration', 'avg'),
        p50: getMetricNumber(data, 'http_req_duration', 'med'),
        p95: getMetricNumber(data, 'http_req_duration', 'p(95)'),
        p99: getMetricNumber(data, 'http_req_duration', 'p(99)'),
        max: getMetricNumber(data, 'http_req_duration', 'max'),
      },
      gatewayRoundTripMs: {
        avg: getMetricNumber(data, 'gateway_round_trip_ms', 'avg'),
        p50: getMetricNumber(data, 'gateway_round_trip_ms', 'med'),
        p95: getMetricNumber(data, 'gateway_round_trip_ms', 'p(95)'),
        p99: getMetricNumber(data, 'gateway_round_trip_ms', 'p(99)'),
      },
      httpReqsPerSecond: getMetricNumber(data, 'http_reqs', 'rate'),
    },
  };
}

export function buildSummaryHandler(name, metadata) {
  return function handleSummary(data) {
    const payload = buildSummaryPayload(name, data, metadata);

    return {
      stdout: `${JSON.stringify(payload, null, 2)}\n`,
      [`load-tests/results/${name}.json`]: JSON.stringify(payload, null, 2),
    };
  };
}
