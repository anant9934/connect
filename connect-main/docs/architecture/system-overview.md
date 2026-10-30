# Tathastu Connect - System Overview & Architecture Foundation

## 1. Executive Summary

**Tathastu Connect** is an independent, production-grade realtime communication and collaboration platform designed for the AI/ML research and engineering ecosystem.

While the platform is natively capable of receiving cryptographically verified collaboration handoffs from **AI Tathastu** (e.g., when complementary research interests, mentorship needs, or project synergies are discovered), Tathastu Connect **never** depends on AI Tathastu to operate. Both systems are independently deployable, maintain separate databases, and communicate exclusively across explicit trust boundaries.

---

## 2. Core Architecture Planes

The platform decouples signaling, application business logic, and high-bandwidth media streams into three strictly separated planes:

```
[ Browser / Native Client ]
       │
       ├── (1) HTTPS [JSON REST / OIDC Assertions] ───────► [ Go API Gateway (Chi) ]
       │                                                              │
       │                                                      ┌───────┴───────┐
       │                                                      ▼               ▼
       │                                                 [ PostgreSQL ]   [ Redis ]
       │                                                 (Audit/Tenants) (Ephemeral/Presence)
       │
       ├── (2) WSS [Realtime App Events & Signaling] ─────► [ Signaling Node ]
       │
       └── (3) WebRTC [SRTP Media: Audio, Video, Screen] ──► [ LiveKit SFU Cluster ]
                                                              │
                                                              ▼
                                                        [ TURN / STUN ]
```

### Plane A: Application & Control Plane (Go API Service)
- **Role**: Identity verification, tenant management, authorization policy evaluation, system health, rate-limiting enforcement, and room access token generation.
- **Technology**: Go standard `net/http` + Chi router, PostgreSQL via `pgx`, Redis via `go-redis`, and structured logging via `slog`.
- **Security Invariant**: Media streams are NEVER routed through this API layer. Client payloads are never trusted.

### Plane B: Realtime Signaling Plane
- **Role**: Low-latency room state events, participant presence handshakes, and ephemeral chat/annotations.
- **Technology**: WebSocket / LiveKit DataChannel.

### Plane C: Media Plane (LiveKit SFU + TURN Fallback)
- **Role**: Selective Forwarding Unit (SFU) handling Opus audio, VP8/VP9/AV1 video, simulcast, and Scalable Video Coding (SVC).
- **Technology**: LiveKit SFU cluster with external TURN/STUN relays for symmetric NAT traversal.

---

## 3. Separation from AI Tathastu

```
┌─────────────────────────────────┐
│           AI Tathastu           │
│   (Discovery, Context, Match)   │
└────────────────┬────────────────┘
                 │
                 │ Signed, short-lived assertion token (Ed25519)
                 │ [sub, iss, aud, exp, jti, contextRef, purpose]
                 │ (No raw profile data, no DB sharing)
                 ▼
┌─────────────────────────────────┐
│     Integration Gateway         │
│  (Signature & Replay Validation)│
└────────────────┬────────────────┘
                 │
                 ▼
┌─────────────────────────────────┐
│        Tathastu Connect         │
│   (Independent Realtime Engine) │
└─────────────────────────────────┘
```

- **Shared State**: Zero. No shared database, no shared caching layer.
- **Failure Tolerance**: If AI Tathastu is completely unreachable or degraded, Tathastu Connect functions without disruption for all direct users and existing sessions.

---

## 4. Repository Structure

```
/apps
    /web             # Next.js App Router frontend (React, Tailwind, Motion, Three.js)
/services
    /api             # Go Net/HTTP + Chi API service
/packages
    /contracts       # Shared TypeScript schemas and federation DTOs
    /ui              # Design system tokens and accessible UI primitives
/infra
    /docker          # Local development Docker Compose (PostgreSQL, Redis)
    /livekit         # SFU deployment templates & configuration
    /security        # Reverse proxy and edge security policies
/migrations          # Versioned SQL migrations (least privilege)
/docs
    /architecture    # Architectural specifications & data flows
    /security        # Threat models, ASVS 5.0 baseline, WebRTC security
    /performance     # Budgets, Web Vitals, and GPU load shedding
    /adr             # Architecture Decision Records
/scripts             # CI and operational automation
/.github/workflows   # Parallel automated security gates
```
