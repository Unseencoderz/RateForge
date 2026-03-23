# Contributing

## Prerequisites

- Node.js 22.14+
- pnpm 10+
- Redis 7+ or Docker Desktop

## Setup

1. Copy the example environment file.

```cmd
copy .env.example .env
```

2. Install dependencies.

```cmd
pnpm install
```

3. Build the shared packages first.

```cmd
pnpm --filter @rateforge/types build
pnpm --filter @rateforge/config build
```

## Running locally

Recommended:

```cmd
docker compose up --build
```

Manual service startup:

```cmd
set PORT=3001 && pnpm --filter @rateforge/rate-limiter dev
set PORT=3000 && set RATE_LIMITER_URL=http://localhost:3001 && pnpm --filter @rateforge/api-gateway dev
pnpm --filter @rateforge/dashboard dev
```

Do not rely on the root `pnpm dev` script as the default contributor workflow. Both server packages read `PORT` from the same `.env`, so explicit per-process overrides are clearer and avoid accidental port collisions.

## Required checks before a PR

Run the full repo checks:

```cmd
pnpm build
pnpm lint
pnpm typecheck
pnpm test
```

Optional helper:

```bash
bash scripts/validate.sh
```

The Husky pre-commit hook runs `pnpm lint-staged`, so staged JS, TS, JSON, Markdown, YAML, and YML files are formatted or linted before commit.

## Commit message format

This repo does not currently enforce commit-message linting, but contributors should use short imperative messages in `type(scope): summary` form.

Examples:

- `feat(gateway): add blocked-client metric`
- `fix(limiter): preserve trace ids in alert logs`
- `docs(readme): document manual local startup`

## Adding a new algorithm

1. Add or update the contract in `packages/types/src/index.ts` if the public rule shape changes.
2. Implement the in-memory algorithm under `packages/rate-limiter/src/algorithms/`.
3. Implement the Redis-backed version if the algorithm must work in distributed mode.
4. Wire the algorithm into `packages/rate-limiter/src/algorithms/factory.ts`.
5. Add unit tests and Redis integration tests for the new code path.
6. Update docs if the algorithm changes public behaviour, operational tradeoffs, or Redis key semantics.

If the change affects key structure, counter semantics, or failure mode, add or update an ADR in `docs/adr/`.

## Working on the gateway or admin API

Keep these constraints intact:

- gateway middleware should remain thin and defer algorithm work to the limiter
- admin writes should continue to flow through the gateway and publish rule updates through Redis-backed storage
- public-facing response shapes should keep using the shared types package

## Working on observability

If you add or rename metrics, logging fields, or alert thresholds:

1. update the dashboard parser if metric names or labels changed
2. update `docs/load-test-results.md` if performance reporting changed
3. update `README.md` so the operational surface stays accurate

## Load testing and release polish

Before using RateForge in a portfolio or resume context:

1. populate `docs/baseline-perf.md`
2. execute the k6 scenarios and update `docs/load-test-results.md`
3. record the final walkthrough using `docs/loom-demo-script.md`
4. replace placeholders in `docs/resume-bullets.md`
