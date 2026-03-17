# ADR 001: Use Redis for distributed rate limit counters

## Context

- RateForge must enforce rate limits across multiple instances of the API gateway and rate-limiter services.
- Counters must be globally consistent and support per-client, per-endpoint limits.
- The system needs sub-millisecond counter operations to keep p99 latency low even under high throughput.
- Redis is already a common dependency in typical infrastructure stacks and is well supported in Node.js.

## Decision

We will use **Redis** as the shared data store for rate limiting counters and metadata. All rate limit algorithms (token bucket, sliding window, etc.) will read and update counters in Redis rather than in-memory or in a SQL database.

## Consequences

- **Positive**
  - Horizontal scaling is straightforward: any number of gateway or limiter instances can share the same Redis cluster.
  - Atomic operations and data structures (e.g. `INCR`, hashes, sorted sets) map naturally to rate limiting algorithms.
  - Operationally familiar technology with good hosting and monitoring options.
- **Negative**
  - The system now depends on Redis availability; outages or high latency in Redis directly impact request throughput.
  - Local development requires running Redis, adding a small setup cost.

