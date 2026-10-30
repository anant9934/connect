# Tathastu Connect 

[![CI Pipeline](https://github.com/tathastu/connect/actions/workflows/ci.yml/badge.svg)](https://github.com/tathastu/connect/actions/workflows/ci.yml)
[![Security Gates](https://github.com/tathastu/connect/actions/workflows/security.yml/badge.svg)](https://github.com/tathastu/connect/actions/workflows/security.yml)
[![OWASP ASVS 5.0](https://img.shields.io/badge/Security-OWASP%20ASVS%205.0-emerald.svg)](docs/security/security-baseline.md)

**Tathastu Connect** is an independent, ultra-secure, and high-performance realtime communication and collaboration platform designed specifically for the AI/ML research and mentorship ecosystem.

It is NOT a generic Zoom or Teams clone. It is an independent platform that can seamlessly receive federated collaboration handoffs from **AI Tathastu** when researchers, mentors, or project partners have complementary synergies—while remaining completely operable, deployable, and resilient even when AI Tathastu is offline.

---

## Non-Negotiable Product Principles

```
SECURITY
  ↳ REALTIME RELIABILITY
      ↳ AUDIO QUALITY
          ↳ LATENCY
              ↳ PERFORMANCE
                  ↳ PRIVACY
                      ↳ UX
                          ↳ VISUAL QUALITY
                              ↳ FEATURE COUNT
```

- **Zero Client Trust**: The server never trusts client-supplied roles, IDs, or permissions (`userId`, `role`, `isAdmin`, `isHost`).
- **Plane Isolation**: Media streams (LiveKit SFU) are strictly decoupled from the application and control gateway (Go Chi API).
- **Federated Autonomy**: No shared database with AI Tathastu. Interoperability occurs exclusively through signed short-lived assertions (Ed25519) with replay defenses.
- **Fail-Closed Defaults**: Missing production secrets, unapproved origins, or mass-assignment fields cause immediate, safe rejection.

---

## Architecture Planes

```
[ Browser Client ]
       │
       ├── HTTPS (REST & Federation) ────────► [ Go Chi API Gateway ] (Port 8080)
       │                                              │
       │                                      ┌───────┴───────┐
       │                                      ▼               ▼
       │                                [PostgreSQL 16]   [Redis 7]
       │
       ├── WSS (Realtime Signaling) ─────────► [ Signaling Node ]
       │
       └── WebRTC (Opus & Video) ────────────► [ LiveKit SFU Cluster ] (Port 7880/7881)
                                                      │
                                                      ▼
                                                [ TURN Relay ]
```

---

## Monorepo Layout

```
/apps
    /web             # Next.js 15 App Router, React, Tailwind CSS, Three.js / R3F
/services
    /api             # Go 1.26+ net/http + Chi API, pgx, go-redis, slog
/packages
    /contracts       # Shared TypeScript schemas, DTOs, and federation contracts
    /ui              # Design system tokens and accessible UI primitives
/infra
    /docker          # Local development Docker Compose (PostgreSQL, Redis)
    /livekit         # LiveKit SFU configuration boundary (Phase 2 preparation)
    /security        # Reverse proxy and security header profiles
/migrations          # Versioned PostgreSQL schema migrations
/docs
    /architecture    # Architectural specifications & data flows
    /security        # Threat models, ASVS 5.0 baseline, WebRTC security plan
    /performance     # Core Web Vitals budgets & GPU load-shedding policies
    /adr             # Architecture Decision Records (0001 - 0007)
/scripts             # Setup, build, and test automation
/.github/workflows   # Parallel automated security & CI quality gates
```

---

## Local Development Workflow

### Prerequisites
- Node.js >= 20 (Node 22 recommended)
- Go >= 1.26
- Docker & Docker Compose (optional for local PostgreSQL & Redis)

### 1. Initialize Infrastructure (Optional)
```bash
npm run docker:up
```

### 2. Run the Go API Service
```bash
npm run dev:api
```
The API starts on `http://localhost:8080`.
- Liveness Probe: `http://localhost:8080/health/live`
- Readiness Probe: `http://localhost:8080/health/ready`
- System Status: `http://localhost:8080/api/v1/system/status`

### 3. Run the Next.js Web Frontend
```bash
npm run dev:web
```
The web application starts on `http://localhost:3000`.

---

## Verification & Automated Test Suites

```bash
# Run Web Frontend Tests
npm run test:web

# Run Frontend Typecheck
npm run typecheck:web

# Run Frontend Production Build
npm run build:web

# Run Go Backend Tests (with race detection & 100% assertions)
npm run test:api
```

---

## Documentation & ADRs

- [System Overview](docs/architecture/system-overview.md)
- [Data Flow Architecture](docs/architecture/data-flow.md)
- [Application Security Baseline (ASVS 5.0)](docs/security/security-baseline.md)
- [STRIDE Threat Model](docs/security/threat-model.md)
- [WebRTC & Media Security Plan](docs/security/webrtc-security-plan.md)
- [Performance Budgets & Tiering](docs/performance/performance-budget.md)
- [ADR 0001: Go and Chi Router](docs/adr/0001-why-go-chi.md)
- [ADR 0002: Next.js App Router](docs/adr/0002-why-nextjs-app-router.md)
- [ADR 0003: LiveKit SFU](docs/adr/0003-why-livekit-sfu.md)
- [ADR 0004: Separate AI Tathastu Boundary](docs/adr/0004-why-separate-ai-tathastu-boundary.md)
- [ADR 0005: 3D Graphics Isolation](docs/adr/0005-why-3d-isolated-from-meeting-runtime.md)
- [ADR 0006: PostgreSQL with pgx](docs/adr/0006-why-postgresql-with-pgx.md)
- [ADR 0007: Redis for Ephemeral State](docs/adr/0007-why-redis-ephemeral-state.md)
