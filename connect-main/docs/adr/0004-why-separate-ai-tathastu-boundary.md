# ADR 0004: Separate Integration Boundary from AI Tathastu

## Status
Accepted

## Context
AI Tathastu performs intelligent discovery, talent mapping, and research synergy analysis. When AI Tathastu discovers that two researchers or mentors should collaborate, it may redirect those users into Tathastu Connect. However, sharing a monolithic database or coupling deployment lifecycles introduces single points of failure, leaks unnecessary private profiling data, and makes independent scaling impossible.

## Decision
We enforce an explicit, decoupled integration boundary. Tathastu Connect never shares a database with AI Tathastu, never queries AI Tathastu's private schema directly, and communicates strictly through signed short-lived cryptographic assertion tokens.

## Consequences
- **Positive**:
  - Independent availability: If AI Tathastu is offline or experiencing an outage, Tathastu Connect continues serving all direct users and existing rooms seamlessly.
  - Least privilege & privacy: Private profile databases remain within AI Tathastu. Only sanitized context references and ephemeral match tokens cross the boundary.
  - Replay protection: Cryptographically signed tokens (Ed25519) with unique `jti` nonces and short expiration windows prevent token reuse.
- **Negative / Tradeoffs**:
  - Requires public-key distribution or JWKS endpoint synchronization between the two independent services.
