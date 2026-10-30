# ADR 0001: Selection of Go Standard net/http and Chi Router for API Services

## Status
Accepted

## Context
Tathastu Connect requires a high-performance, low-latency, and memory-safe backend control plane. The service is responsible for session authorization, strict request validation, federated token exchange, and signaling coordination. Heavy monolithic frameworks (e.g. Django, Rails, Spring Boot, or bloated Go microframeworks) add excessive memory overhead, deep reflection chains, large dependency trees, and increased attack surfaces.

## Decision
We select Go (using standard library `net/http` combined with the lightweight `go-chi/chi/v5` router).

## Consequences
- **Positive**:
  - Extremely minimal attack surface and minimal external dependencies.
  - Sub-millisecond routing overhead with idiomatic `http.Handler` interoperability.
  - Low CPU and RSS memory consumption under high concurrent connection loads.
  - Deterministic compilation and straightforward containerization with distroless/scratch images.
  - First-class concurrency model (goroutines) with structured context cancellation and deadlines.
- **Negative / Tradeoffs**:
  - Requires explicit engineering of validation, middleware chains, and error handling without framework magic. (This is deliberately preferred for security-critical systems).
