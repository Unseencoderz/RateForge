# RateForge

![CI Pipeline](https://github.com/yourusername/rateforge/actions/workflows/pr.yml/badge.svg)
![Coverage](https://img.shields.io/badge/Coverage-80%25-brightgreen.svg)
![Deployment Status](https://github.com/yourusername/rateforge/actions/workflows/deploy.yml/badge.svg)
Distributed rate limiting platform with Redis-backed counters, API gateway middleware, and a metrics dashboard.

## ASCII architecture (high level)

```text
          ┌──────────────────┐
          │   Client Apps    │
          └────────┬─────────┘
                   │ HTTP
                   ▼
          ┌──────────────────┐
          │  API Gateway     │  (@rateforge/api-gateway)
          │  - Auth & routing│
          │  - RateLimit API │
          └────────┬─────────┘
                   │ RPC / HTTP
                   ▼
          ┌──────────────────┐
          │  Rate Limiter    │  (@rateforge/rate-limiter)
          │  - Algorithms    │
          │  - Redis counters│
          └────────┬─────────┘
                   │
                   ▼
          ┌──────────────────┐
          │      Redis       │
          │  (shared state)  │
          └────────┬─────────┘
                   │
                   ▼
          ┌──────────────────┐
          │   Dashboard      │  (@rateforge/dashboard)
          │ - Metrics & logs │
          └──────────────────┘
```

## Services

- **API Gateway** (`packages/api-gateway`): entrypoint for client traffic, auth, and HTTP-facing rate limit endpoints.
- **Rate Limiter** (`packages/rate-limiter`): implements algorithms and updates Redis counters.
- **Dashboard** (`packages/dashboard`): UI for metrics, rules, and alerts.
- **Shared Types** (`packages/types`): shared TypeScript contracts (`RateLimitRequest`, `RuleConfig`, etc.).
- **Config** (`packages/config`): validated environment configuration (e.g. `REDIS_URL`, `JWT_SECRET`).

## Quick start (development)

```bash
pnpm install
pnpm dev
```

> This README is a skeleton. As phases complete, fill in detailed setup, configuration, and usage instructions per service.
