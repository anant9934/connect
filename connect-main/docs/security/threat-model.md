# Tathastu Connect - STRIDE Threat Model & Trust Boundaries

## 1. System Trust Boundaries

```
[ Browser / Untrusted Client ]
               │
══ Trust Boundary 1: Public Internet / CDN Edge ════════════════════════════
               │
[ Edge / CDN / TLS Termination ]
               │
══ Trust Boundary 2: Application Demarcation ═══════════════════════════════
               │
        ┌──────┴───────────────────────────────────────┐
        ▼                                              ▼
[ Next.js Web Frontend ]                       [ Go API Gateway ]
        │                                              │
        │                                              │
        ▼                                              ▼
══ Trust Boundary 3: Internal Private VPC / Secure Backend ════════════════
                                                       │
                                      ┌────────────────┼────────────────┐
                                      ▼                ▼                ▼
                                 [PostgreSQL]       [Redis]     [LiveKit SFU]
                                 (Persistence)    (Ephemeral)   (Media Plane)
                                                       │                │
                                                       ▼                ▼
══ Trust Boundary 4: External Systems ══════════════ [AI Tathastu]   [TURN Nodes]
```

---

## 2. STRIDE Assessment Matrix

| Target Component | Threat Category | Threat Description | Mitigation Strategy | Status |
|:---|:---|:---|:---|:---|
| **Landing & Web App** | **Spoofing** | Attacker impersonates platform using domain spoofing or lookalike URL. | Strict HSTS with preloading, CAA DNS records, EV/OV certificates. | **Implemented / Planned (DNS)** |
| | **Tampering** | Script injection / DOM manipulation via third-party assets. | Restrictive CSP, Subresource Integrity (SRI), no inline eval scripts. | **Implemented** |
| | **Information Disclosure** | Bundling server credentials or private APIs into client Next.js bundle. | Strict `NEXT_PUBLIC_` isolation. Zero private secrets in frontend code. | **Implemented** |
| | **Denial of Service** | Heavy 3D scene exhausting client GPU/CPU and crashing browser. | Tiered adaptive rendering, pause on hidden/offscreen, reduced-motion mode. | **Implemented** |
| **Go API Service** | **Spoofing** | Client sends fabricated `userId`, `role`, or `isAdmin` attributes. | Zero client trust. Identity and privileges derived exclusively from server session. | **Implemented** |
| | **Tampering** | Mass-assignment attacks injecting unintended model fields via JSON. | `DisallowUnknownFields` strict JSON decoding; explicit request DTOs. | **Implemented** |
| | **Repudiation** | Malicious actions executed without accountability. | Immutable audit logging with `X-Request-ID` and structured `slog`. | **Implemented** |
| | **Information Disclosure** | Stack traces, database topology, or internal IPs exposed in 500 errors. | Panic recoverer sanitizes all outputs to generic `INTERNAL_SERVER_ERROR`. | **Implemented** |
| | **Denial of Service** | Slowloris or oversized payload memory exhaustion. | Hardened HTTP server timeouts (`ReadHeaderTimeout: 5s`), 1MB `MaxBytesReader`. | **Implemented** |
| | **Elevation of Privilege**| Unauthorized cross-origin requests initiating sensitive operations. | Strict CORS allowlist; rejection of wildcard `*` with credentials. | **Implemented** |
| **Database (PostgreSQL)** | **Tampering** | SQL Injection via malformed user input parameters. | Parameterized queries exclusively via `pgxpool`. Zero string concatenation. | **Implemented** |
| | **Elevation of Privilege**| Compromised app user gains database superuser rights. | Application role is restricted non-superuser with least-privilege grants. | **Implemented** |
| **Redis Cache** | **Information Disclosure** | Unauthenticated network access to cached session data. | Network isolation in private VPC; authentication and TLS mandatory in production. | **Implemented** |
| | **Denial of Service** | Cache exhaustion from unbounded presence records. | Strict TTL enforcement on all ephemeral keys; namespaced keys. | **Implemented** |
| **AI Tathastu Federation** | **Spoofing** | Forged Tathastu discovery redirect bringing unauthorized user. | Cryptographically signed short-lived assertions (Ed25519) with strict issuer checks. | **Implemented** |
| | **Tampering** | Replay of intercepted assertion token across sessions. | Replay protection via unique token nonce (`jti`) and 300s max TTL. | **Implemented** |
| | **Information Disclosure** | Tathastu private profiles exposed via URL query parameters. | Zero profile PII in redirect URLs; opaque exchange codes only. | **Implemented** |
| **WebRTC & LiveKit Boundary** | **Tampering / Hijacking**| Unauthorized participant injecting or tapping room media. | DTLS-SRTP encryption, cryptographically signed short-lived room tokens. | **Planned (Phase 2)** |
| | **Denial of Service** | Malformed RTP/RTCP packets or ICE flood against SFU. | LiveKit port sandboxing, ICE rate limiting, isolated media plane. | **Planned (Phase 2)** |
