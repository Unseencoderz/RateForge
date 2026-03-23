# Baseline Performance

## Status

This file is the baseline companion to `docs/load-test-results.md`. No measured baseline values are committed yet in this workspace.

Do not quote throughput or latency claims from RateForge until this table has been filled with a real run.

## Goal

Capture a small, repeatable pre-optimisation baseline before comparing the heavier k6 scenarios.

Use the same safe gateway route used by the current load-test harness:

- target: `GET /api/v1/admin/rules`
- auth: admin JWT

## Example command

If `autocannon` is installed globally:

```cmd
autocannon -c 10 -d 30 -H "Authorization: Bearer YOUR_TOKEN" http://localhost:3000/api/v1/admin/rules
```

If it is not installed globally:

```cmd
npx autocannon -c 10 -d 30 -H "Authorization: Bearer YOUR_TOKEN" http://localhost:3000/api/v1/admin/rules
```

## Capture checklist

Record:

1. p50 latency
2. p95 latency
3. p99 latency
4. average req/sec
5. non-2xx rate
6. Redis memory at the end of the run

Redis memory example:

```cmd
redis-cli -u %REDIS_URL% INFO memory | findstr used_memory_human
```

## Results

| Date    | Target                    | Concurrency | Duration |     p50 |     p95 |     p99 | Req/sec | Error rate | Redis memory | Notes                      |
| ------- | ------------------------- | ----------: | -------: | ------: | ------: | ------: | ------: | ---------: | ------------ | -------------------------- |
| Pending | `GET /api/v1/admin/rules` |          10 |      30s | Pending | Pending | Pending | Pending |    Pending | Pending      | Replace with measured data |
