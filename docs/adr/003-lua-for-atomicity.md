# ADR 003: Use Redis Lua scripts for atomic rate limit operations

## Context

- Rate limiting requires multiple read/modify/write steps on shared counters (e.g. check current tokens, deduct tokens, set expiry).
- Performing these steps as separate Redis commands can lead to race conditions under high concurrency.
- We need strong guarantees that each request sees a consistent view of the counters to avoid both over-throttling and under-throttling.

## Decision

We will implement core rate limit operations as **Redis Lua scripts**, executed with `EVALSHA` from the rate-limiter service. Each script will perform the full algorithm step atomically (read current state, compute new state, update counters, and return the result) inside Redis.

## Consequences

- **Positive**
  - Eliminates race conditions caused by interleaved commands from different processes.
  - Reduces network round-trips by bundling logic into a single Redis call.
  - Keeps the algorithm logic close to the data, improving performance at high request volumes.
- **Negative**
  - Lua scripts add complexity to the codebase and require careful testing.
  - Debugging script errors can be harder than debugging plain TypeScript logic.
  - Some managed Redis services may impose limits on script size or execution time.

