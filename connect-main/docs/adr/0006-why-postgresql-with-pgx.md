# ADR 0006: Selection of PostgreSQL with pgx Driver

## Status
Accepted

## Context
Tathastu Connect requires robust persistence for tenant organizations, user permissions, multi-tenant collaboration nodes, audit trail logs, and historical meeting metadata. Relational integrity, ACID compliance, and strong schema migrations are essential.

## Decision
We select PostgreSQL 16+ as our primary relational database, accessed in Go via `jackc/pgx/v5` (`pgxpool`).

## Consequences
- **Positive**:
  - `pgx` is a native, high-performance PostgreSQL driver in pure Go, bypassing standard `database/sql` reflection overhead and providing native binary format decoding.
  - Native connection pooling (`pgxpool`) handles high-concurrency client workloads with strict connection count limits and idle timeouts.
  - Enforces parameterized queries natively, mitigating SQL injection risks.
  - Rich JSONB indexing enables flexible metadata queries for collaboration node attributes without schema churn.
- **Negative / Tradeoffs**:
  - Requires explicit schema migration management and least-privilege role provisioning.
