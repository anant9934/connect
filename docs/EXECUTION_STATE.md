# Execution State

Compact checkpoint. Resume from here. Budget: free tier only.

**Branch:** `feat/trusted-attendance-foundation`. Never merge to `main` without owner approval.

## Verified infrastructure (read through APIs, 2026-11-02)

| Item | Evidence |
| :--- | :--- |
| Render | Service `connect`, plan **free**, region ohio, branch `main`, auto-deploy on, live commit `213d517` |
| Runtime DB role | `neondb_owner` through the pooler, not `connect_app` |
| Vercel | Project `connect`, root `connect-main/apps/web`, production branch `main` |

## Open

1. **RLS gate:** CI job `postgres-16-integration` runs the role tests on a disposable Postgres 16.
2. **Runtime role:** production does not use the restricted roles. See `RELEASE_READINESS.md`.
3. Tenant-dependent features wait on item 2.
