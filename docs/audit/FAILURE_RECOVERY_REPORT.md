# FAILURE AND RECOVERY AUDIT REPORT

**Target Environment:** Production (`https://connect-a2fi.onrender.com`)
**Deployment Date:** 2026-10-31 / 2026-11-01
**Auditor:** Production SRE & Resilience Engineer
**Repository:** `https://github.com/anant9934/connect`
**Inspected Commit:** `49264bd8a11bd32edcc067f0487cc965f15f7d86`

---

## 1. Executive Summary

This report evaluates how the Connect backend handles downstream dependency degradation, network partitions, resource exhaustion, and operational failures across PostgreSQL, Redis, LiveKit Cloud, and Cloudflare R2.

---

## 2. Dependency Failure Matrix

| Downstream Dependency | Failure Condition | Application Behavior & Error Handling | Health Check Status | Recovery Mechanism |
| :--- | :--- | :--- | :--- | :--- |
| **Upstash Redis** | Network unreachable / TLS handshake timeout / auth failure | Fail-closed: `ratelimit.Middleware` intercepts request and returns `HTTP 503 Service Unavailable` (`SERVICE_UNAVAILABLE`). Protected against rate limit bypass. | `/health/ready` returns `HTTP 503 {"status":"degraded"}` within 2s. | `go-redis` driver automatically attempts connection pool reconnection on subsequent requests. |
| **Neon PostgreSQL** | Connection pool exhausted / DB restart / network timeout | Requests wait up to context timeout (5s); returns `HTTP 500 / 503` without crashing process. Zero stack trace leaks. | `/health/ready` returns `HTTP 503 {"status":"degraded"}` within 2s. | `pgxpool.Pool` automatically cleans dead connections and re-establishes pool connections upon DB recovery. |
| **LiveKit Cloud SFU** | Cloud outage / network partition | **Decoupled Architecture:** Client token generation relies purely on local HMAC-SHA256 signing; tokens continue to be minted without network calls to LiveKit. Room deletion / mute RPCs time out after 5s without hanging server. | Process remains healthy (`/health/live` returns 200). | Twirp HTTP client reconnects automatically. Database marks room as ended even if SFU RPC times out. |
| **Cloudflare R2** | Storage outage / token revocation | File uploads and downloads fail with `HTTP 500 Internal Error` (`ErrStorageFailure`). Zero memory leaks or disk filling. | Unaffected (R2 is not in critical path of auth or rooms). | AWS SDK client retries transient errors with exponential backoff. |
| **Application Panic** | Nil pointer dereference or runtime panic in handler | Chi `Recoverer` middleware intercepts panic, logs structured JSON error, and sends `HTTP 500 INTERNAL_ERROR` to client. Server process remains running. | Process remains alive. | Zero-downtime panic recovery. |

---

## 3. Resilience Architecture Highlights

1. **Lightweight Non-Leaking Probes:**
   - `/health/live`: Tests process event loop only. Zero external dependencies. Used by Render for liveness probes.
   - `/health/ready`: Executes `db.Ping(ctx)` and `redis.Ping(ctx)` with a strict 2-second timeout. If either database or cache fails, returns `HTTP 503 {"status":"degraded"}` to take instance out of load balancer rotation.
2. **Local Token Minting Resilience:**
   LiveKit token generation does not require a round-trip to the LiveKit Cloud servers. Tokens are cryptographically minted in-memory using the shared `LIVEKIT_API_SECRET` and validated by clients directly against LiveKit SFU.
3. **Fail-Closed Security Design:**
   In production (`APP_ENV=production`), missing Redis or broken rate limiting immediately fails closed rather than silently falling back to insecure in-memory bypasses.
