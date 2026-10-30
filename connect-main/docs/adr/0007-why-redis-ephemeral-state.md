# ADR 0007: Redis for Ephemeral State, Presence, and Rate Limiting

## Status
Accepted

## Context
High-concurrency realtime systems require microsecond-speed coordination for participant presence, ephemeral room states, distributed rate limiting, and temporary token blacklists. Subjecting the primary relational database to hundreds of queries per second for presence heartbeats and token bucket checks degrades persistence throughput and introduces latency spikes.

## Decision
We utilize Redis 7+ exclusively for transient, ephemeral state. Redis is strictly forbidden from becoming the permanent source of truth for critical persistent user records.

## Consequences
- **Positive**:
  - In-memory sub-millisecond sliding window rate limiting without impacting PostgreSQL.
  - Native TTL key expiration guarantees automatic cleanup of stale presence and temporary room locks.
  - Low blast radius: If Redis restarts or drops cache, persistent data remains intact in PostgreSQL.
- **Negative / Tradeoffs**:
  - Operational overhead of running and monitoring an in-memory cluster with TLS enabled in production.
