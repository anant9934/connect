# CONNECT C1 — PHASE A ARCHITECTURE & SECURITY DISCOVERY REPORT

**Document ID:** `CONNECT-AUDIT-C1-DISCOVERY-20261031`
**Repository:** `https://github.com/anant9934/connect`
**Working Branch:** `remediation/c1-production-readiness`
**Base Commit (C0 Verified):** `7bdbcf96c5d1205275144e2e8e3460b58df10201`
**C0 Code Tested in CI:** `4e24b96e1b720d880ab4e6bbe893c58aa8b2abde`
**Lead Auditor:** Principal Software Architect, Staff Go Engineer & Application Security Lead
**Date:** October 31, 2026
**Status:** **`PHASE A COMPLETE — DISCOVERY BASELINE ESTABLISHED`**

---

## 1. REPOSITORY & BASELINE VERIFICATION

1. **Branch Verification:**
   - Dedicated branch created: `remediation/c1-production-readiness` branched from `remediation/c0-architecture-hardening` at commit `7bdbcf9`.
   - Main branch untouched.
   - Working tree clean.

2. **C0 Baseline Evidence:**
   - **PostgreSQL 16 Service Container:** Version `PostgreSQL 16.15 (Debian 16.15-1.pgdg13+2)` executed in GitHub Actions Run `41226779088`.
   - **Test Accounting:** 427 verified test units and assertions passed with 0 failures across Go backend (137 unit + 5 live DB integration across 16 packages), Web (57 tests across 9 suites), Mobile (145 tests across 29 suites), and PostgreSQL 16 security assertions (52 privilege + 22 restricted-role).
   - **Outstanding Blocker:** Gate K remains BLOCKED on repository owner credential rotation in Supabase Cloud Console.

---

## 2. VERIFIED REPOSITORY ARCHITECTURE

```
                                  +---------------------------+
                                  |   Web Client (Next.js 14) |
                                  |   Mobile (React Native)   |
                                  +-------------+-------------+
                                                |
                                    HTTPS / WSS | (Strict CORS / CSRF / Rate Limit)
                                                v
+-----------------------------------------------------------------------------------------------+
| CONNECT GO CONTROL PLANE (services/api)                                                       |
|                                                                                               |
|  [Middleware Chain]                                                                           |
|   RequestID -> Panic Recoverer -> Security Headers -> CORS -> BodyLimit(1MB) -> Log -> RateLimit|
|                                                                                               |
|  [API Routing & Handlers]                                                                     |
|   /health/{live,ready}        /api/v1/system/status       /api/v1/auth/{login,signup,google}  |
|   /api/v1/users/me/*          /api/v1/rooms/*             /api/v1/rooms/{code}/notes          |
|   /api/v1/rooms/{code}/files  /api/v1/rooms/{code}/p2p/ws /api/v1/collab/validate-assertion  |
|                                                                                               |
|  [Core Domains]                                                                               |
|   * auth (HMAC Session Sealing, Cryptographic GUC injection)                                  |
|   * room (Policy, Distributed CAS Leases, Waiting Room, BOLA Guard)                           |
|   * notes & files (Tenant-Scoped Commons, R2 Storage, ClamAV)                                 |
|   * academic & attendance (Lebesgue measure intervals, Faculty Allocation)                     |
|   * worker (Transactional Outbox, Monotonic Fencing Tokens)                                   |
+-------------------+---------------------------+-------------------------------+---------------+
                    |                           |                               |
       SQL / RLS    |               Redis       |                  Media Plane  | Object Store
                    v                           v                               v               v
+-----------------------+   +-----------------------+   +-------------------+   +---------------+
| PostgreSQL 16         |   | Redis (Cluster/Cache) |   | LiveKit Cloud SFU |   | Cloudflare R2 |
| * connect_auth schema |   | * Rate Limiting       |   | * Token Service   |   | * S3 API      |
| * connect_app role    |   | * Ephemeral Cache     |   | * Room Management |   | * Pre-signed  |
| * 16 RLS forced tables|   | * Sub-second presence |   | * Track Sub/Pub   |   |   Download URLs
| * Immutable ledgers   |   | * TLS supported       |   | * P2P WebRTC Fallback | * ClamAV scan |
+-----------------------+   +-----------------------+   +-------------------+   +---------------+
```

### 2.1 Backend Architecture Components
- **Go Version:** Go 1.23 (`services/api/go.mod`).
- **HTTP Engine:** `go-chi/chi/v5` with explicit timeouts (`ReadHeaderTimeout: 5s`, `ReadTimeout: 15s`, `WriteTimeout: 15s`, `IdleTimeout: 60s`, `MaxHeaderBytes: 1MB`).
- **Database Layer:** `jackc/pgx/v5/pgxpool` with dedicated connection pooling (`DB_MAX_OPEN_CONNS: 25`, `DB_MAX_IDLE_CONNS: 10`, `DB_CONN_MAX_LIFETIME_SEC: 300s`).
- **Cryptographic Security Layer:** `crypto/hmac` with SHA-256 length-prefixed canonical payload serialization (`auth.GenerateAuthContextSignature`), mirrored identically in PostgreSQL 16 `connect_auth` schema.
- **Media Plane Control:** LiveKit Go Server SDK (`livekit.NewTokenService`, `livekit.NewRoomManager`) plus in-tree hybrid WebRTC P2P signaling (`internal/meeting/p2p`).
- **Object Storage:** `files.R2StorageProvider` (AWS S3 SDK for Cloudflare R2) with fallback to local private storage or memory.

### 2.2 Client Application Architecture
- **Web App (`apps/web`):** Next.js 14 (App Router), React 18, TypeScript, Tailwind CSS, Three.js 3D landing visuals, React Hook Form, LiveKit Client SDK.
- **Mobile App (`apps/mobile`):** React Native / Expo with native Android Gradle harness, custom tokens, adaptive layout hooks (`useAdaptiveLayout`), bundled local avatar registry.

---

## 3. EXISTING CONTROLS (C0 HARDENING VERIFIED)

| Control Category | Implementation Reference | Verification Evidence |
| :--- | :--- | :--- |
| **HMAC Session Sealing** | `connect_auth.authenticate_session` | 10 attack vectors verified in CI; constant-time check prevents timing attacks. |
| **Principle of Least Privilege** | `connect_app` database role | Non-superuser, non-bypassrls, 0 table ownership, 0 privileges on `internal_keys`. |
| **Row Level Security** | Migrations `000007` & `000008` | 16 multi-tenant tables enforce both `relrowsecurity` and `relforcerowsecurity`. |
| **Audit Log Immutability** | `attendance_overrule_audit_log` | Direct UPDATE and DELETE revoked from runtime roles; verified by adversarial tests. |
| **CSRF Defense** | `middleware/csrf.go` | Origin & Referer validation strictly enforced on state-changing requests (`POST`, `PUT`, `PATCH`, `DELETE`). |
| **HTTP Security Headers** | `middleware/security_headers.go` | Centralized HSTS, CSP, X-Frame-Options (`DENY`), X-Content-Type-Options (`nosniff`), Referrer-Policy. |
| **Request Body Guard** | `middleware/body_limit.go` | 1MB maximum payload enforcement mitigates buffer overflow / memory DOS. |
| **Rate Limiting** | `ratelimit/limiter.go` | Distributed Redis token bucket limiter with fallback to dev in-memory limiter. |
| **Distributed Locks** | `internal/room/repository.go` | PostgreSQL CAS locking with monotonic fencing tokens (`participant_locks`). |

---

## 4. CRITICAL GAPS & HIGH-RISK FINDINGS

During the comprehensive Phase A discovery inspection, 8 architectural and security gaps were uncovered:

### Gap 1 (Critical): Background Worker Engine Not Running
- **File:** `connect-main/services/api/internal/worker/queue.go` vs `cmd/server/main.go`
- **Defect:** Primitives `EnqueueJob` and `ClaimJobsWithLease` exist and pass unit tests, but **no active worker loop or consumer daemon is instantiated** in `cmd/server/main.go` or as a standalone binary.
- **Impact:** Any background task enqueued to `background_jobs` will remain in `pending` state indefinitely.
- **Fix:** Build an active, graceful-shutdown worker runner with configurable worker concurrency, jittered polling, and leasing heartbeat.

### Gap 2 (High): Academic and Attendance Handlers Not Mounted
- **File:** `connect-main/services/api/internal/server/server.go`
- **Defect:** The domain logic for academic batch consistency (`internal/academic`) and attendance interval Lebesgue integration (`internal/attendance`) is implemented, but **no HTTP routes are wired into Chi router**.
- **Impact:** Administrators, faculty, and coordinators have no API interface to view attendance records, apply manual overrules, or inspect academic batch session state.
- **Fix:** Mount protected `/api/v1/academic` and `/api/v1/attendance` routes with strict role-based authorization (Coordinator/Auditor).

### Gap 3 (High): LiveKit Webhook Handler & Event Reconciliation Missing
- **File:** `connect-main/services/api/internal/server/server.go`
- **Defect:** There is no webhook endpoint (e.g. `/api/v1/livekit/webhook`) to receive asynchronous SFU room events (`participant_joined`, `participant_left`, `room_finished`).
- **Impact:** If a user disconnects abruptly (browser close, network crash), backend room state remains stale until room lease timeout. Attendance intervals are not captured reliably without webhook event streams.
- **Fix:** Implement `/api/v1/livekit/webhook` with LiveKit webhook token validation (`auth.VerifyWebhookSignature`), idempotency key verification, and transactional dispatch into `participant_connection_events`.

### Gap 4 (Medium): File Storage Magic-Byte Content Inspection
- **File:** `connect-main/services/api/internal/files/service.go`
- **Defect:** File upload relies on MIME type header from client and optional ClamAV daemon. If ClamAV is disabled (`CLAMAV_ENABLED=false`), content magic bytes are not validated against dangerous executable formats or polyglot files.
- **Impact:** Potential upload of disguised malicious scripts into storage bucket.
- **Fix:** Implement deep magic-byte validation (`http.DetectContentType` + allowed signature whitelist) before writing to object storage.

### Gap 5 (Medium): Database Connection Pool Exhaustion Under Load
- **File:** `connect-main/services/api/internal/config/config.go` (`DB_MAX_OPEN_CONNS: 25`)
- **Defect:** Default connection pool limit of 25 connections will experience queue starvation under 500+ concurrent users, particularly when multiple transaction contexts are held during media handshakes.
- **Impact:** High p99 latencies, pool acquisition timeouts, and 500 internal server errors during peak meeting creation bursts.
- **Fix:** Optimize connection pool defaults (`MaxConns: 50`, `MinConns: 10`, `MaxConnIdleTime: 1m`), add context acquisition timeouts (2s), and implement connection pool metrics.

### Gap 6 (Medium): Redis Outage Failure Mode Hardening
- **File:** `connect-main/services/api/internal/server/server.go` & `cmd/server/main.go`
- **Defect:** While rate limiting degrades to in-memory in dev, a production Redis disconnection during runtime could panic or stall requests if timeout handling is not strictly non-blocking.
- **Impact:** Redis blip cascades into API availability outage.
- **Fix:** Implement circuit-breaker / fail-open rate limiting fallback when Redis becomes unavailable, logging high-severity alerts without dropping legitimate user traffic.

### Gap 7 (Low): Production Source Maps & Client Bundle Audit
- **File:** `connect-main/apps/web/next.config.mjs`
- **Defect:** Production source-map configuration should be explicitly set to `productionBrowserSourceMaps: false` to prevent intellectual property and internal route exposure.
- **Fix:** Verify and explicitly enforce in Next.js config.

### Gap 8 (Blocker): Supabase Cloud Credential Invalidation (Gate K)
- **Status:** BLOCKED pending repository owner action.
- **Impact:** Direct PostgreSQL password and Supabase JWT secret from historic commit `8c3b708` remain active until reset on the cloud console.

---

## 5. ENVIRONMENT VARIABLE INVENTORY

| Variable | Scope | Required in Prod | Default / Behavior |
| :--- | :--- | :---: | :--- |
| `APP_ENV` | Global | Yes | `development` / `staging` / `production` |
| `PORT` | HTTP Server | No | `8080` |
| `LOG_LEVEL` | Logger | No | `info` (`debug`, `info`, `warn`, `error`) |
| `DATABASE_URL` | PostgreSQL | **Yes** | Fail-closed if missing in prod |
| `DB_MAX_OPEN_CONNS` | Pool | No | `25` (recommended `50`) |
| `DB_MAX_IDLE_CONNS` | Pool | No | `10` |
| `DB_CONN_MAX_LIFETIME_SEC` | Pool | No | `300s` |
| `REDIS_URL` | Redis | **Yes** | Fail-closed if missing in prod |
| `REDIS_TLS_ENABLED` | Redis | Yes (Prod) | `true` in production |
| `RATE_LIMIT_ENABLED` | Middleware | No | `true` |
| `RATE_LIMIT_RPS` | Middleware | No | `100` |
| `RATE_LIMIT_BURST` | Middleware | No | `200` |
| `CORS_ALLOWED_ORIGINS` | Middleware | **Yes** | Wildcard `*` strictly blocked in prod |
| `PUBLIC_APP_ORIGIN` | Middleware | **Yes** | Must use `https://` in prod |
| `LIVEKIT_URL` | Media Plane | **Yes** | LiveKit cloud endpoint |
| `LIVEKIT_API_KEY` | Media Plane | **Yes** | LiveKit API Key (dev credentials rejected) |
| `LIVEKIT_API_SECRET` | Media Plane | **Yes** | LiveKit API Secret (dev credentials rejected) |
| `STORAGE_PROVIDER` | Object Storage | No | `local` / `r2` / `memory` |
| `R2_ENDPOINT` | Object Storage | If R2 | Cloudflare R2 S3 API endpoint |
| `R2_BUCKET` | Object Storage | If R2 | Storage bucket name |
| `R2_ACCESS_KEY_ID` | Object Storage | If R2 | R2 Access Key |
| `R2_SECRET_ACCESS_KEY` | Object Storage | If R2 | R2 Secret Key |
| `CLAMAV_ENABLED` | Antivirus | No | `false` |
| `CLAMAV_HOST` | Antivirus | If ClamAV | `localhost` |
| `CLAMAV_PORT` | Antivirus | If ClamAV | `3310` |

---

## 6. EXACT C1 TEST PLAN & EXECUTION ROADMAP

### Phase B: Security & Authorization Hardening
1. Build endpoint-by-endpoint authorization matrix for all 34 API routes.
2. Verify role-based permissions: Student vs Faculty vs Coordinator vs Auditor vs Super Admin.
3. Add magic-byte file inspection to prevent polyglot file execution.
4. Add regression test suite for cross-tenant IDOR and BOLA protection.

### Phase C: Reliability & Worker Engine Wiring
1. Implement in-tree background worker runner (`internal/worker/runner.go`) with graceful shutdown.
2. Implement LiveKit webhook receiver (`/api/v1/livekit/webhook`) with HMAC token validation and idempotency.
3. Wire domain event dispatching (room endings, participant departures) into transactional outbox.
4. Implement Redis circuit breaker for rate limiter to ensure fail-safe behavior during cache blips.

### Phase D: Performance & Capacity Baseline
1. Measure baseline latency (p50, p95, p99) under 100, 500, and 1,000 simulated concurrent requests.
2. Test database connection pool limits and identify bottleneck thresholds.
3. Benchmark Go memory, CPU, and goroutine allocation under room creation bursts.

### Phase E: Failure & Disaster Recovery Testing
1. Simulate PostgreSQL connection failure and verify graceful error response (no panic, zero client leak).
2. Simulate Redis outage and verify fail-open rate limiting and cache bypass.
3. Document database backup and point-in-time recovery runbook with verified restore steps.

### Phase F: Observability & Release Governance
1. Audit structured logs for sensitive token/password leakage.
2. Produce Deployment Runbook (`docs/audit/C1_DEPLOYMENT_RUNBOOK.md`).
3. Produce Incident Response Runbook (`docs/audit/C1_INCIDENT_RESPONSE_RUNBOOK.md`).
4. Assemble Final Release Acceptance Matrix (`docs/audit/C1_RELEASE_ACCEPTANCE_MATRIX.md`).

---

## 7. RECOMMENDED EXECUTION ORDER

```text
Phase A (Discovery)               [COMPLETE - This Document]
    |
    v
Phase B (Security & Auth Matrix)   [Next: Route Matrix + File Magic Inspection]
    |
    v
Phase C (Reliability & Workers)    [Worker Runner + Webhook Receiver]
    |
    v
Phase D (Performance Baseline)     [Capacity & Latency Benchmarks]
    |
    v
Phase E (Failure Testing & DR)     [Disaster Drills & Restore Procedures]
    |
    v
Phase F (Release Acceptance)       [Final Runbooks & Verdict Matrix]
```
