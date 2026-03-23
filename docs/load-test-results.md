# Load Test Results

## Status

The repository now includes runnable k6 scenarios for burst, sustained, and spike traffic. No measurements are recorded in this document yet, because `k6` was not installed in this workspace and no load run was executed as part of this implementation pass.

That is intentional: P6-M1-T3 says to optimise only after measuring, so no speculative performance change has been committed here.

## Target path

The current public gateway only exposes rate-limited routes under `/api/v1`, and the safest read-only route in that surface is `GET /api/v1/admin/rules`.

For that reason, the load-test harness defaults to:

- `RF_BASE_URL=http://localhost:3000`
- `RF_TARGET_PATH=/api/v1/admin/rules`

Override `RF_TARGET_PATH` later if the gateway grows a non-admin application route that still flows through the same rate-limit middleware.

## Required environment

The default target is an admin route, so the scripts require a bearer token:

```cmd
set JWT_SECRET=change-me-in-production-in-production
node -e "const jwt=require('jsonwebtoken'); console.log(jwt.sign({ userId: 'load-test-admin', tier: 'pro', role: 'admin' }, process.env.JWT_SECRET, { expiresIn: '1h' }))"
```

Set the resulting token before you run any scenario:

```cmd
set RF_BASE_URL=http://localhost:3000
set RF_TARGET_PATH=/api/v1/admin/rules
set RF_BEARER_TOKEN=PASTE_TOKEN_HERE
```

Optional knobs:

- `RF_IP_STRATEGY=distributed` creates a new forwarded IP for almost every iteration. This is the default for `burst` and `spike`.
- `RF_IP_STRATEGY=sticky` pins each VU to its own forwarded IP. This is the default for `sustained`.
- `RF_IP_STRATEGY=shared` forces all traffic through one forwarded IP, which is useful when you want to stress the blocking path and alerting thresholds.
- `RF_SLEEP_SECONDS=1` changes the pacing for the sustained test.
- `RF_TIMEOUT=5s` overrides the per-request timeout.

## Commands

```cmd
pnpm loadtest:burst
pnpm loadtest:sustained
pnpm loadtest:spike
```

Each run writes an exportable JSON summary to:

- `load-tests/results/burst.json`
- `load-tests/results/sustained.json`
- `load-tests/results/spike.json`

## Capture checklist

For each run, record:

1. k6 summary JSON from `load-tests/results/*.json`
2. Gateway and limiter `/metrics` snapshots before and after the run
3. Redis memory at the end of the run

Example Redis memory capture:

```cmd
redis-cli -u %REDIS_URL% INFO memory | findstr used_memory_human
```

If you are using Docker Compose instead of a locally installed Redis CLI:

```cmd
docker compose exec redis redis-cli INFO memory | findstr used_memory_human
```

## Baseline comparison

Use `docs/baseline-perf.md` as the smaller `autocannon -c 10 -d 30` reference run, then compare the three k6 scenarios below against that baseline.

## Results

| Scenario  | Target                    | p50 latency | p95 latency | p99 latency | Req/sec | Error rate | Blocked rate | Redis memory | Notes                             |
| --------- | ------------------------- | ----------: | ----------: | ----------: | ------: | ---------: | -----------: | ------------ | --------------------------------- |
| Burst     | `GET /api/v1/admin/rules` |     Pending |     Pending |     Pending | Pending |    Pending |      Pending | Pending      | `burst.js` uses 200 VUs for 30s   |
| Sustained | `GET /api/v1/admin/rules` |     Pending |     Pending |     Pending | Pending |    Pending |      Pending | Pending      | `sustained.js` uses 50 VUs for 5m |
| Spike     | `GET /api/v1/admin/rules` |     Pending |     Pending |     Pending | Pending |    Pending |      Pending | Pending      | `spike.js` ramps to 500 VUs       |

## Bottleneck Follow-up

Pending measurement.

Do not commit a bottleneck fix until at least one of the scenario exports and the matching metrics snapshot show a clear failure mode, such as:

- latency inflation in the gateway before 429s rise
- 5xx responses from the gateway or limiter
- Redis memory growth from distributed-key churn
- auth or internal-service call overhead dominating the request budget
