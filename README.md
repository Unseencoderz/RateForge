# RateForge

RateForge is a TypeScript monorepo for a Redis-backed distributed rate limiting platform. It combines an Express API gateway, a dedicated rate-limiter service, a React dashboard, shared contracts, and a thin SDK.

The current implementation covers:

- token bucket, fixed window, and sliding window algorithms
- Redis-backed counters with Lua-backed token bucket execution
- gateway-side auth, rule management, whitelist and blacklist controls
- Prometheus metrics, structured JSON logging, request and trace IDs, and blocked-traffic alerting
- a React dashboard for live metrics and admin rule management
- Docker, Docker Compose, Kubernetes manifests, and GitHub Actions validation and image builds
- k6 load-test scripts for burst, sustained, and spike scenarios

## Architecture

```text
                                 +----------------------+
                                 |  @rateforge/sdk      |
                                 |  Thin HTTP client    |
                                 +----------+-----------+
                                            |
                                            v
+------------------+      HTTP      +---------------------------+
| Client apps      +--------------->+ API Gateway               |
| or test scripts  |                | packages/api-gateway      |
+------------------+                | - JWT auth                |
                                    | - admin API               |
                                    | - rate-limit middleware   |
                                    | - /health /ready /metrics |
                                    +-------------+-------------+
                                                  |
                                                  | signed internal HTTP
                                                  v
                                    +---------------------------+
                                    | Rate Limiter              |
                                    | packages/rate-limiter     |
                                    | - algorithm factory       |
                                    | - Redis-backed counters   |
                                    | - /health /ready /metrics |
                                    | - alert evaluator         |
                                    +-------------+-------------+
                                                  |
                                                  v
                                    +---------------------------+
                                    | Redis                     |
                                    | counters + rules store    |
                                    +-------------+-------------+
                                                  ^
                                                  |
                             metrics + admin API  |
                                                  |
                                    +-------------+-------------+
                                    | Dashboard                 |
                                    | packages/dashboard        |
                                    | - overview metrics        |
                                    | - rules management        |
                                    +---------------------------+
```

## Monorepo Layout

- `packages/api-gateway`: public HTTP gateway, admin API, readiness endpoints, metrics, and request logging
- `packages/rate-limiter`: algorithm execution, Redis integration, internal endpoints, metrics, and alerting
- `packages/dashboard`: Vite + React dashboard with `/` overview and `/rules` admin views
- `packages/sdk`: thin HTTP client for consuming RateForge HTTP endpoints; current methods span both limiter and gateway surfaces
- `packages/types`: shared domain contracts and constants
- `packages/config`: validated environment configuration
- `docs/adr`: architecture decision records
- `load-tests`: k6 scenarios and exported summary location
- `k8s`: deployment, service, config, and HPA manifests

## Algorithms

Implemented algorithms:

- `token_bucket`: default algorithm, with a Redis Lua implementation for atomic refill and consume
- `fixed_window`: counter-based limiter for simple quota windows
- `sliding_window`: sorted-set-based limiter for more precise rolling windows

Current caveat:

- `leaky_bucket` exists in `AlgorithmType`, but the factory currently logs a warning and falls back to token bucket instead of providing a dedicated implementation

Rules are stored as `RuleConfig` records and are matched by endpoint pattern first, then by client tier. Counters use the composite Redis key pattern:

```text
rateforge:rl:{ruleId}:{userId}:{ip}:{endpoint}
```

Changing that key format invalidates existing counters and should be treated as a breaking operational change.

## Local Development

### Prerequisites

- Node.js 22.14+ and pnpm 10+
- Redis 7+
- Docker Desktop if you want the simplest full-stack local run
- k6 if you want to execute the load-test scripts locally

### Environment setup

Copy the example environment file and adjust secrets as needed:

```cmd
copy .env.example .env
pnpm install
```

Key environment variables:

| Variable            | Purpose                                                             |
| ------------------- | ------------------------------------------------------------------- |
| `REDIS_URL`         | Redis connection used by gateway and limiter                        |
| `RATE_LIMITER_URL`  | Internal URL the gateway uses to reach the limiter                  |
| `PORT`              | Default process port for whichever service is started in that shell |
| `JWT_SECRET`        | JWT signing and verification secret                                 |
| `LOG_LEVEL`         | Structured logger verbosity                                         |
| `ALERT_WEBHOOK_URL` | Optional Slack-compatible webhook sink                              |
| `VITE_GATEWAY_URL`  | Dashboard build-time default gateway target                         |

### Recommended local stack

Docker Compose is the least error-prone local path because it sets per-service ports correctly:

```cmd
docker compose up --build
```

Services then come up on:

- gateway: `http://localhost:3000`
- limiter: `http://localhost:3001`
- dashboard: `http://localhost:4000`

### Manual local run

The root `pnpm dev` script is not the recommended path for this repo because both server packages read the same `PORT` variable from `.env`. Start each runtime with an explicit port override instead.

Terminal 1:

```cmd
set PORT=3001 && pnpm --filter @rateforge/rate-limiter dev
```

Terminal 2:

```cmd
set PORT=3000 && set RATE_LIMITER_URL=http://localhost:3001 && pnpm --filter @rateforge/api-gateway dev
```

Terminal 3:

```cmd
pnpm --filter @rateforge/dashboard dev
```

If you run the dashboard in Vite dev mode, point it at the gateway URL from the UI shell after the app opens.

## Verification Commands

Shared validation:

```cmd
pnpm build
pnpm lint
pnpm typecheck
pnpm test
```

Smoke and task-level validation helpers:

```bash
bash scripts/validate.sh
bash scripts/smoke.sh P2-M5-T5
```

## API Reference

### Public gateway endpoints

| Method | Path                            | Notes                                                   |
| ------ | ------------------------------- | ------------------------------------------------------- |
| `GET`  | `/health`                       | Liveness probe                                          |
| `GET`  | `/ready`                        | Readiness check for Redis and rate-limiter reachability |
| `GET`  | `/metrics`                      | Prometheus text format                                  |
| `GET`  | `/api/v1/admin/rules`           | Requires admin JWT                                      |
| `POST` | `/api/v1/admin/rules`           | Replace the active ruleset, requires admin JWT          |
| `POST` | `/api/v1/admin/reset/:clientId` | Reset counters for a client, requires admin JWT         |
| `POST` | `/api/v1/admin/blacklist`       | Add an IP to the blacklist, requires admin JWT          |
| `POST` | `/api/v1/admin/whitelist`       | Add an IP to the whitelist, requires admin JWT          |

### Internal limiter endpoints

The rate-limiter service exposes internal endpoints that are intended for signed service-to-service traffic rather than direct public access:

- `POST /api/v1/check`
- `POST /api/v1/reset/:clientId`
- `GET /api/v1/rules`
- `POST /api/v1/blacklist`
- `GET /api/v1/blacklist/check`
- `POST /api/v1/whitelist`
- `GET /api/v1/whitelist/check`

### Admin JWT example

For local testing, generate an admin token with the current `JWT_SECRET`:

```cmd
node -e "const jwt=require('jsonwebtoken'); console.log(jwt.sign({ userId: 'admin-user', tier: 'pro', role: 'admin' }, process.env.JWT_SECRET || 'change-me-in-production-in-production', { expiresIn: '1h' }))"
```

### Example admin request

```cmd
curl -H "Authorization: Bearer YOUR_TOKEN" http://localhost:3000/api/v1/admin/rules
```

## SDK Usage

The SDK is a thin wrapper around the current HTTP surfaces, but the API is not fully unified yet:

- `checkLimit()` targets `/api/v1/check`, which exists on the limiter service
- `getRules()` and `resetLimit()` target gateway admin routes

Use separate client instances if you want to call both surfaces today:

```ts
import { AlgorithmType, RateForgeClient } from '@rateforge/sdk';

const limiterClient = new RateForgeClient({
  baseUrl: 'http://localhost:3001',
  apiKey: process.env.RATEFORGE_TOKEN!,
});

const gatewayClient = new RateForgeClient({
  baseUrl: 'http://localhost:3000',
  apiKey: process.env.RATEFORGE_TOKEN!,
});

const result = await limiterClient.checkLimit({
  clientId: 'user-123',
  identity: { userId: 'user-123', ip: '127.0.0.1', tier: 'pro' },
  endpoint: '/api/v1/example',
  method: 'GET',
  timestamp: Date.now(),
  algorithm: AlgorithmType.TOKEN_BUCKET,
});

const rules = await gatewayClient.getRules();
```

## Observability

Implemented observability features:

- Prometheus metrics from the gateway and limiter at `/metrics`
- structured Winston logs with request IDs and trace IDs
- dashboard polling every five seconds for request rate, blocked traffic, top blocked clients, and latency
- blocked-traffic alerting in the limiter when `blocked_requests / total_requests > 0.2`

Dashboard routes:

- `/`: live metrics overview
- `/rules`: rules administration UI

## Load Testing

k6 scenarios are committed in `load-tests/`:

- `pnpm loadtest:burst`
- `pnpm loadtest:sustained`
- `pnpm loadtest:spike`

Supporting docs:

- [Baseline performance](docs/baseline-perf.md)
- [Load-test results](docs/load-test-results.md)

The scripts currently default to `GET /api/v1/admin/rules`, because that is the stable read-only route already protected by the gateway middleware.

## Deployment

Deployment assets included in the repo:

- `docker-compose.yml` for local orchestration
- `docker-compose.test.yml` for Redis-backed integration testing
- `packages/*/Dockerfile` for image builds
- `k8s/` manifests for Deployments, Services, ConfigMaps, Secret template, and limiter HPA
- `.github/workflows/pr.yml` for PR validation
- `.github/workflows/build.yml` for Docker image builds and GHCR pushes

This repo does not currently contain a committed deploy workflow. The previous README badge for deployment has been removed because it did not reflect the actual workflow files in the repository.

## Live Demo Status

P6-M2 expects live demo URLs and a Loom recording, but those are not safe to hardcode unless they are current.

During this documentation pass on March 24, 2026, the last-known Railway URLs were not reachable from this workspace. Replace the placeholders below with the current public links before sharing the repository externally:

- Gateway URL: `ADD_CURRENT_GATEWAY_URL`
- Dashboard URL: `ADD_CURRENT_DASHBOARD_URL`
- Loom demo URL: `ADD_CURRENT_LOOM_URL`

Use the recording guide in [loom-demo-script.md](docs/loom-demo-script.md) when you capture the final walkthrough.

## ADRs

Architecture decisions currently documented:

- [001 Redis for counters](docs/adr/001-redis-for-counters.md)
- [002 Token bucket as the default](docs/adr/002-token-bucket-default.md)
- [003 Lua for atomicity](docs/adr/003-lua-for-atomicity.md)
- [004 Fail open on Redis outage](docs/adr/004-fail-open-on-redis-outage.md)
