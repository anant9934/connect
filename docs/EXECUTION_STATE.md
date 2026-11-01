# Execution State

Compact checkpoint. Resume from here. Budget: free tier only.

**Branch:** `feat/trusted-attendance-foundation`. Never merge to `main` without owner approval.

## Verified infrastructure (read through APIs, 2026-11-02)

| Item | Evidence |
| :--- | :--- |
| Render | Service `connect`, plan **free**, region ohio, branch `main`, auto-deploy on, live commit `213d517` |
| Runtime DB role | `neondb_owner` through the pooler, not `connect_app` |
| Vercel | Project `connect`, root `connect-main/apps/web`, production branch `main` |

## Verified on disposable Postgres 16 (CI run 41338955770, commit `8b4258a`)

- Migrations 000001-000011, SQL security suites, 000010 and 000011 rollback and re-apply.
- Webhook store as `connect_app` and `connect_worker`: room visible, duplicate delivery, unknown room.
- Attendance job as `connect_worker`, for a room with no class session only.
- Web and mobile typecheck and tests, web build, Go tests.

## Open

1. Full attendance workflow with a class session, enrollments and a policy: **not yet tested**.
2. Tenant isolation is untested at API level. The API uses `neondb_owner` and sets no per-request auth
   context, so it cannot simply move to `connect_app`. The in-process worker shares that pool.
3. Tenant-dependent features wait on items 1 and 2.
4. Investigate latency: API in Ohio; `.env` comment places Redis in Singapore, and the rate limiter calls it per request.
