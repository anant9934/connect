# CONNECT — MAIN BRANCH DEPLOYMENT AUDIT

**Document ID:** `CONNECT-DEPLOY-AUDIT-MAIN-20261101`
**Repository:** `https://github.com/anant9934/connect`
**Deployment Target Branch:** `main`
**Inspected Commit SHA:** `86f8f87059a5840d24bf51a77e812d62d29aa450`
**Lead Engineer:** Principal DevOps Engineer, Senior Go Backend Engineer & Production SRE
**Date:** November 1, 2026
**Status:** **`AUDIT COMPLETE — DEPLOYMENT DEFECTS IDENTIFIED`**

---

## 1. REPOSITORY STRUCTURE & WORKSPACE ROOTS

The repository uses a monorepo structure where core services reside inside the `connect-main` directory:

```text
/ (Repository Root)
├── .github/workflows/          # CI/CD Workflows (quality-gate.yml, commit-validation.yml)
├── AGENTS.md                   # Workspace automation protocol & Git standards
├── config/                     # Git engine configurations
├── docs/                       # Architecture, security, and deployment documentation
│   ├── deployment/             # Deployment runbooks and environment matrices
│   └── audit/                  # Stage audit records
├── scripts/                    # Automation scripts (git tools, test harnesses)
├── tests/sql/                  # PostgreSQL 16 privilege and security assertions
└── connect-main/               # Monorepo Application Root
    ├── apps/
    │   ├── web/                # Next.js 14 Frontend Application (Vercel target)
    │   └── mobile/             # React Native / Expo Mobile Application
    ├── migrations/             # PostgreSQL 16 Migrations (000001 through 000009)
    ├── render.yaml             # Render Blueprint Configuration (Staging/Production)
    ├── services/
    │   └── api/                # Go 1.23 Backend Control Plane (Render target)
    └── packages/               # Shared contracts and UI primitives
```

### Critical Deployment Path Mappings:
- **Vercel Project Root:** `connect-main/apps/web` (NOT repository root `.`)
- **Render Service Root:** `connect-main` with Dockerfile `services/api/Dockerfile` (or `connect-main/services/api`)

---

## 2. GO BACKEND AUDIT (`connect-main/services/api`)

### 2.1 Entry Points
- Primary HTTP server binary: `cmd/server/main.go`
- Tenancy backfill CLI: `cmd/backfill_tenancy/main.go`
- Migration execution CLI: `cmd/run_migration/main.go`
- Credential rotation validator: `cmd/verify_rotation/main.go`

### 2.2 Dockerfile & Build Configuration (`services/api/Dockerfile`)
> [!WARNING]
> **BLOCKING DOCKER BUILD DEFECT ON MAIN**:
> In `connect-main/services/api/Dockerfile` line 6:
> ```dockerfile
> FROM golang:1.26-alpine AS builder
> ```
> `golang:1.26-alpine` does NOT exist on Docker Hub (current stable releases are `1.23` and `1.24`).
> Attempting to deploy on Render via Docker will immediately fail during image build with `manifest unknown: manifest for golang:1.26-alpine not found`.
> **Remediation Required:** Update Dockerfile builder to `golang:1.23-alpine` (matching `go.mod` and CI).

### 2.3 Port Binding & Render Compatibility
- Render assigns a dynamic port via environment variable `PORT` (e.g. `10000`).
- `internal/config/config.go` reads `PORT` (default `8080`) and `server.New` listens on `fmt.Sprintf(":%d", cfg.Port)`.
- This correctly binds to all network interfaces (`0.0.0.0:$PORT`) as required by Render.
- Health endpoints `/health/live` and `/health/ready` exist and return HTTP 200 without requiring database superuser permissions.

---

## 3. NEXT.JS FRONTEND AUDIT (`connect-main/apps/web`)

### 3.1 Framework & Output
- **Framework:** Next.js 14 (App Router), React 18, TypeScript.
- **Node.js Version:** Requires Node.js `>=18.17.0` (Recommended: Node.js 20.x or 22.x).
- **Configuration (`next.config.mjs`):**
  - Next.js rewrites:
    ```javascript
    source: '/api/v1/:path*' -> destination: `${INTERNAL_API_URL}/api/v1/:path*`
    source: '/health/:path*' -> destination: `${INTERNAL_API_URL}/health/:path*`
    ```
  - This server-side proxying enables cookie-based authentication (`__Host-tc_session`) without cross-site cookie blocking.

### 3.2 Vercel Configuration (`connect-main/apps/web/vercel.json`)
```json
{
  "framework": "nextjs",
  "cleanUrls": true,
  "trailingSlash": false
}
```
- **Deployment Requirement:** On Vercel Project Settings, the **Root Directory** must be configured to `connect-main/apps/web`. If left as `.`, Vercel framework detection will fail.

---

## 4. DATABASE & MIGRATIONS AUDIT (`connect-main/migrations`)

### 4.1 Migration Inventory on `main`:
1. `000001_init_schema.sql` — Users and rooms
2. `000002_auth_and_rooms.sql` — Sessions and participants
3. `000003_waiting_room_and_history.sql` — Waiting room queues and meeting historical ledgers
4. `000004_meeting_notes_and_files.sql` — Meeting notes and files
5. `000005_user_profile_and_providers.sql` — Profiles, OAuth identities, avatars
6. `000006_participant_distributed_locks.sql` — Participant distributed locks
7. `000007_tenancy_and_academic_core.sql` — Organizations, departments, courses, batches, enrollments
8. `000008_auth_context_and_rls.sql` — HMAC session authentication, GUC functions, 16 forced RLS tables
9. `000009_background_jobs_outbox.sql` — Background jobs outbox table and worker locks

### 4.2 Migration Defect on `main`:
> [!CAUTION]
> **BLOCKING MIGRATION DEFECT IN `000008_auth_context_and_rls.sql`**:
> On `main`, lines 799, 818, 887, 905, 923, 941, and 978 contain invalid column references:
> ```sql
> WHERE ce.course_batch_id = faculty_allocations.course_batch_id
> ```
> Neither `course_enrollments` nor `faculty_allocations` has a column named `course_batch_id`. The actual schema uses `ce.batch_id` and `faculty_allocations.course_id`.
> Additionally, `meeting_notes.visibility` and `meeting_files.uploaded_by` / `is_public` are missing from migration 000008 on `main`.
> If applied to PostgreSQL, migration 000008 will fail immediately with `ERROR: column ce.course_batch_id does not exist`.
> **Remediation Required:** Port the verified relational joins and columns from `remediation/c0-architecture-hardening` into `main`.

---

## 5. DIFFERENCES: `main` VS `remediation/c1-production-readiness`

| Component | Status on `main` (`86f8f87`) | Status on `remediation/c1-production-readiness` | Impact on Deployment |
| :--- | :--- | :--- | :--- |
| **`000008_auth_context_and_rls.sql`** | Invalid column `course_batch_id` | Correct relational joins (`cb.id = ce.batch_id`) | **CRITICAL:** DB migrations will crash on `main` |
| **`meeting_notes.visibility`** | Column missing | Column added via `ALTER TABLE` | **HIGH:** Notes API fails on missing column |
| **`services/api/Dockerfile`** | `golang:1.26-alpine` | `golang:1.26-alpine` (both need fix) | **CRITICAL:** Render Docker build will fail |
| **`postgres_integration_test.go`** | Unconditional fatal in CI | Conditioned on `REQUIRE_TEST_DATABASE` | **HIGH:** Go tests fail if no local DB in CI |
| **Root `render.yaml`** | Missing at repo root | Missing at repo root | **MEDIUM:** Render Blueprint cannot find config at root |
| **Root `vercel.json`** | Missing at repo root | Missing at repo root | **MEDIUM:** Requires manual root setting in Vercel UI |

---

## 6. DEPLOYMENT BLOCKERS & REMEDIATION PLAN

### Blocker 1: Invalid Dockerfile Base Image (`golang:1.26-alpine`)
- **Fix:** Update `Dockerfile` to `golang:1.23-alpine`.

### Blocker 2: Migration 000008 Column Mismatches
- **Fix:** Update `000008_auth_context_and_rls.sql` on `main` to join through `course_batches` and add missing commons columns (`visibility`, `uploaded_by`, `is_public`).

### Blocker 3: Root Deployment Configs
- **Fix:** Add a root-level `render.yaml` pointing to `./connect-main/services/api/Dockerfile` with context `./connect-main/services/api` so Render Blueprint works out of the box.

### Blocker 4: Environment Variables Setup
- **Fix:** Provide exact environment variable catalog in `docs/deployment/ENVIRONMENT_VARIABLES.md` for both Vercel and Render dashboards.
