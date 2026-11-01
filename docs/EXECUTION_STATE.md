# Execution State

Compact checkpoint. Resume from here. Budget: free tier only.

**Branch:** `feat/trusted-attendance-foundation`. Never merge to `main` without owner approval.

## Verified infrastructure (read through APIs, 2026-11-02)

| Item | Evidence |
| :--- | :--- |
| Render | Service `connect`, plan **free**, region ohio, branch `main`, auto-deploy on, live commit `213d517` |
| Runtime DB role | `neondb_owner` through the pooler, not `connect_app` |
| Vercel | Project `connect`, root `connect-main/apps/web`, production branch `main` |

## Verified on disposable Postgres 16 (CI run 41362764262, commit `a3d8ac3`)

- Migrations 000001-000017, SQL security suites, rollback and re-apply of 000010-000017.
- `TestWorkflowDB_APITenantIsolation`: the full router with auth, room, notes and files all on `connect_app`:
  account lifecycle, room flow, forged leave and identity theft, waiting room, institutional rooms, suspended member,
  scheduled meetings and passcodes.
- `TestWorkflowDB_EveryTableHasRLS`: every public table has forced RLS; only `schema_metadata` is exempt.
- `TestWorkflowDB_NotesHTTP`, `FilesHTTP`, `WebhookHTTPBoundary`, `AttendanceQueueLifecycle`,
  `WorkerRestartRecovery`, `ClassSessionAttendance`, `AuthContextIsolation`.

Security defects fixed on this branch (none deployed yet): anyone could end another participant's session via
`/leave`; `/participants` was public; `/join` and `/admission/request` minted guest tokens for client-supplied
identities; `/token` accepted a bare identity; the waiting room flag was never persisted, so it did nothing in
Postgres; users, sessions, audit and participant tables had no RLS; any user could join any room's P2P signaling.

Limits:
- Only the attendance job handler is tested as `connect_worker`; room cleanup and file purge handlers are not.
- The API still connects as `neondb_owner` in production, where RLS may not apply. Moving to `connect_app` and
  `connect_worker` needs a separate worker pool and owner approval.
- SECURITY DEFINER functions and foreign key checks need the table owner to bypass RLS; unconfirmed in production.
- Deploy order: migrations 000013-000017 must be applied before this code, or the API fails.
- Behavior change: guests are refused in institutional rooms. Mobile has no waiting room screen yet.

## Current phase: product scope, Phase 1 gaps

Security foundation items 1-6 are done at the level above. Scheduled meetings and passcodes are built and tested at
the API level; their web and mobile screens are typechecked only, never run in a browser or on a device.
Attendance is not Phase 3; see `FEATURE_REGISTER.md`.

## Next action

Co-host and host transfer (P1-07), then course management API and screens (P2-06), which scheduling of classes,
attendance views, notifications and the course workspaces all depend on.

## Not started or blocked

- Most product scope: see `FEATURE_REGISTER.md`. Docker Desktop is still absent; CI is the disposable database.
- Production role attributes, provider quotas, measured Redis latency: no read access yet.
