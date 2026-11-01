# Execution State

Compact checkpoint. Resume from here. Budget: free tier only.

**Branch:** `feat/trusted-attendance-foundation`. Never merge to `main` without owner approval.

## Verified infrastructure (read through APIs, 2026-11-02)

| Item | Evidence |
| :--- | :--- |
| Render | Service `connect`, plan **free**, region ohio, branch `main`, auto-deploy on, live commit `213d517` |
| Runtime DB role | `neondb_owner` through the pooler, not `connect_app` |
| Vercel | Project `connect`, root `connect-main/apps/web`, production branch `main` |

## Verified on disposable Postgres 16 (CI run 41343853509, commit `82f9242`)

- Migrations 000001-000012, SQL security suites, rollback and re-apply of 000010-000012.
- `TestWorkflowDB_ClassSessionAttendance`: webhook as `connect_app`, reconcile as `connect_worker`, two
  tenants, policy version, late/reconnect/absent, duplicates, atomic failure and retry, overrule kept,
  student/faculty/other-tenant visibility.
- `TestWorkflowDB_AuthContextIsolation`: `WithAuthContext` as `connect_app`: pool reuse, forged settings,
  denied membership, rollback, 40 concurrent requests.

Bugs found by these tests and fixed: invalid `participant_left` SQL, restrictive policy blocking the
worker, infinite RLS recursion between `faculty_allocations` and `course_enrollments`.

Limits: the handler is called directly, not through the job queue. SECURITY DEFINER helpers depend on
the function owner bypassing RLS, which is unconfirmed for production's owner role.

## Current phase: 2 of the directive (API request context)

`WithAuthContext` exists but **no API path uses it**. About 49 database call sites in `auth`, `room`,
`notes`, `files` and `audit` still use the raw pool.

## Next action

Convert `notes` first (2 call sites) to `WithAuthContext`, with HTTP cross-tenant tests, then `files`,
then `room`, including a narrow resolver for guest room access, which has no session.

## Not started or blocked

- Tenant isolation matrix across HTTP routes; moving the API to `connect_app` (needs owner approval).
- Most product scope: see `FEATURE_REGISTER.md`. Docker Desktop is still absent; CI is the disposable database.
- Production role attributes, provider quotas, measured Redis latency: no read access yet.
