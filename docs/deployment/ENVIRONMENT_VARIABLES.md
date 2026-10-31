# CONNECT — PRODUCTION ENVIRONMENT VARIABLES SPECIFICATION

**Document ID:** `CONNECT-ENV-SPEC-20261101`
**Repository:** `https://github.com/anant9934/connect`
**Target Environments:** Vercel (Frontend) & Render (Backend Control Plane)
**Lead Engineer:** Principal DevOps Engineer & Production SRE
**Date:** November 1, 2026

---

## 1. SECURITY & CONFIGURATION POLICIES

> [!CAUTION]
> **STRICT ZERO-SECRET COMMIT POLICY**:
> - Never commit `.env`, `.env.production`, `.env.local` or credential files to Git.
> - Never print plaintext secrets (passwords, private keys, API secrets) in logs or documentation.
> - All production secrets must be configured directly via the **Vercel Project Dashboard** and **Render Service Dashboard**.
> - Never expose backend secrets (`SUPABASE_SERVICE_ROLE_KEY`, `LIVEKIT_API_SECRET`, `R2_SECRET_ACCESS_KEY`) in client bundles through `NEXT_PUBLIC_*` prefixes.

---

## 2. RENDER BACKEND ENVIRONMENT VARIABLES MATRIX

Configure these in Render Dashboard -> **Your Service** -> **Environment**:

| Variable | Required | Secret? | Type | Example / Format | Purpose |
| :--- | :---: | :---: | :--- | :--- | :--- |
| `APP_ENV` | **Yes** | No | String | `production` (or `staging`) | Sets application runtime environment mode |
| `PORT` | Auto | No | Integer | `10000` (Render injected) | Dynamic port Render listens on |
| `LOG_LEVEL` | No | No | String | `info` (`debug`, `info`, `warn`, `error`) | Minimum log level for structured `slog` output |
| `DATABASE_URL` | **Yes** | **Yes** | URI | `postgres://[user]:[password] (at) [pooler-host]:6543/postgres?sslmode=require` | PostgreSQL / Supabase connection pooler URL |
| `DB_MAX_OPEN_CONNS` | No | No | Integer | `25` | Maximum open database pool connections |
| `DB_MAX_IDLE_CONNS` | No | No | Integer | `10` | Maximum idle database pool connections |
| `DB_CONN_MAX_LIFETIME_SEC` | No | No | Integer | `300` | Maximum connection reuse duration in seconds |
| `REDIS_URL` | **Yes** | **Yes** | URI | `rediss://default:[PASS]@[host]:6379` | Upstash / Redis TLS connection URL |
| `REDIS_TLS_ENABLED` | **Yes** | No | Boolean | `true` | Enforces TLS (required for Upstash / Cloud Redis) |
| `RATE_LIMIT_ENABLED`| No | No | Boolean | `true` | Enables distributed token-bucket rate limiting |
| `RATE_LIMIT_RPS` | No | No | Integer | `100` | Rate limiter base tokens per second |
| `RATE_LIMIT_BURST` | No | No | Integer | `200` | Rate limiter maximum burst token allowance |
| `CORS_ALLOWED_ORIGINS` | **Yes** | No | String | `https://connect.aitathastu.com,https://your-app.vercel.app` | Comma-separated list of allowed web origins (no wildcards) |
| `PUBLIC_APP_ORIGIN` | **Yes** | No | URL | `https://connect.aitathastu.com` | Canonical frontend domain for CSRF and cookies |
| `LIVEKIT_URL` | **Yes** | No | URL | `wss://[project].livekit.cloud` | LiveKit Cloud SFU WebSockets URL |
| `LIVEKIT_API_KEY` | **Yes** | **Yes** | String | `APIxxxxxxxxxxxx` | LiveKit Cloud API Key |
| `LIVEKIT_API_SECRET` | **Yes** | **Yes** | String | `[secret-32-chars-minimum]` | LiveKit Cloud API Secret (used for token minting) |
| `STORAGE_PROVIDER` | No | No | String | `r2` (or `local`, `memory`) | Selected object storage driver |
| `R2_ENDPOINT` | If R2 | No | URL | `https://[account-id].r2.cloudflarestorage.com` | Cloudflare R2 S3 API compatible endpoint |
| `R2_BUCKET` | If R2 | No | String | `connect-production-files` | Cloudflare R2 private bucket name |
| `R2_ACCESS_KEY_ID` | If R2 | **Yes** | String | `[r2-access-key]` | Cloudflare R2 API token access key |
| `R2_SECRET_ACCESS_KEY` | If R2 | **Yes** | String | `[r2-secret-key]` | Cloudflare R2 API token secret key |
| `R2_REGION` | If R2 | No | String | `auto` | Cloudflare R2 bucket region |
| `CLAMAV_ENABLED` | No | No | Boolean | `false` | Enables real-time ClamAV daemon antivirus scanning |

---

## 3. VERCEL FRONTEND ENVIRONMENT VARIABLES MATRIX

Configure these in Vercel Dashboard -> **Project Settings** -> **Environment Variables**:

| Variable | Required | Client-Exposed? | Example / Format | Purpose |
| :--- | :---: | :---: | :--- | :--- |
| `INTERNAL_API_URL` | **Yes** | **No** (Server Only) | `https://[your-render-service].onrender.com` | Target URL for Next.js server-side `/api/v1/*` rewrites |
| `NEXT_PUBLIC_API_URL` | No | Yes | `https://[your-render-service].onrender.com` or empty | Direct browser API base URL (empty uses Next.js proxy) |
| `NEXT_PUBLIC_SUPABASE_URL` | **Yes** | Yes | `https://qirzlvahobehykkkgouz.supabase.co` | Supabase project API base URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | **Yes** | Yes | `sb_publishable_okoG8yzDLmuKbZQOUwvbxA_nzIKntvd` | Supabase client publishable API key |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | **Yes** | Yes | `sb_publishable_okoG8yzDLmuKbZQOUwvbxA_nzIKntvd` | Legacy alias for publishable anon key |
| `NEXT_PUBLIC_LIVEKIT_URL` | **Yes** | Yes | `wss://[project].livekit.cloud` | Client LiveKit WebSockets signaling URL |

---

## 4. LOCAL DEVELOPMENT TEMPLATE (`.env.example`)

For local development only, create `connect-main/.env` (which is gitignored):

```ini
# Application Mode
APP_ENV=development
PORT=8080
LOG_LEVEL=debug

# Database (PostgreSQL / Supabase)
DATABASE_URL=postgres://connect_app:[password] (at) localhost:5432/connect_db?sslmode=disable
DB_MAX_OPEN_CONNS=25
DB_MAX_IDLE_CONNS=10
DB_CONN_MAX_LIFETIME_SEC=300

# Redis Cache & Rate Limiter
REDIS_URL=redis://localhost:6379/0
REDIS_TLS_ENABLED=false
RATE_LIMIT_ENABLED=true
RATE_LIMIT_RPS=100
RATE_LIMIT_BURST=200

# Origins & Web Security
CORS_ALLOWED_ORIGINS=http://localhost:3000,http://127.0.0.1:3000
PUBLIC_APP_ORIGIN=http://localhost:3000

# LiveKit Media Plane
LIVEKIT_URL=http://localhost:7880
LIVEKIT_API_KEY=devkey
LIVEKIT_API_SECRET=devsecret

# Object Storage
STORAGE_PROVIDER=local
CLAMAV_ENABLED=false
```
