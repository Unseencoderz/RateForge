# ADR 002: Token bucket as the default rate limiting algorithm

## Context

- RateForge needs to support multiple algorithms (fixed window, sliding window, token bucket, etc.) for different use cases.
- Most API consumers expect short bursts of traffic to be smoothed out without immediately hitting hard limits.
- We want a default algorithm that balances fairness, predictability, and implementation simplicity.

## Decision

We will use the **token bucket** algorithm as the **default** rate limiting strategy for client and endpoint rules. Other algorithms (e.g. fixed window, sliding window) may be supported, but token bucket will be the baseline that new rules use unless explicitly overridden.

## Consequences

- **Positive**
  - Handles short bursts gracefully while still enforcing an average rate over time.
  - Simple mental model for developers and operators configuring rules (capacity + refill rate).
  - Maps cleanly onto Redis operations using counters and TTLs.
- **Negative**
  - Slightly more complex to reason about than a basic fixed-window counter.
  - Some edge cases (e.g. very spiky traffic) may require tuning bucket size and refill rate to avoid user-visible throttling.

