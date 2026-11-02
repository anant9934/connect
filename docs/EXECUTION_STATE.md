# Execution State

Compact checkpoint. Resume from here. Budget: free tier only.

**Branch:** `feat/trusted-attendance-foundation`. Never merge to `main` without owner approval.

## Verified infrastructure (read through APIs, 2026-11-02)

| Item | Evidence |
| :--- | :--- |
| Render | Service `connect`, plan **free**, region ohio, branch `main`, auto-deploy on, live commit `213d517` |
| Runtime DB role | `neondb_owner` through the pooler, not `connect_app` |
| Vercel | Project `connect`, root `connect-main/apps/web`, production branch `main` |

## Verified on disposable Postgres 16 (CI run 41367090494, commit `d228b9c`)

- Migrations 000001-000019, SQL security suites, rollback and re-apply of 000010-000019.
- `TestWorkflowDB_APITenantIsolation`: the full router with auth, room, notes and files all on `connect_app`:
  account lifecycle, room flow, forged leave and identity theft, waiting room, institutional rooms, suspended member,
  scheduled meetings, passcodes, co-hosts, host transfer including concurrent requests, account routes, Google checks.
- `TestWorkflowDB_InstitutionWorkflow`: institution to attendance report, two tenants, every role.
- `TestWorkflowDB_HostSuccession`, `TestWorkflowDB_RoomCleanupAsWorker`.
- Real Chrome against the built web app and API as `connect_app`: `e2e_schedule_passcode.mjs`, `e2e_institution.mjs`.
  No LiveKit server exists in CI, so media and in-room panels are not exercised.
- `TestWorkflowDB_EveryTableHasRLS`: every public table has forced RLS; only `schema_metadata` is exempt.
- `TestWorkflowDB_NotesHTTP`, `FilesHTTP`, `WebhookHTTPBoundary`, `AttendanceQueueLifecycle`,
  `WorkerRestartRecovery`, `ClassSessionAttendance`, `AuthContextIsolation`.

Security defects fixed on this branch (none deployed yet): anyone could end another participant's session via
`/leave`; `/participants` was public; `/join` and `/admission/request` minted guest tokens for client-supplied
identities; `/token` accepted a bare identity; the waiting room flag was never persisted, so it did nothing in
Postgres; users, sessions, audit and participant tables had no RLS; any user could join any room's P2P signaling.

Limits:
- File purge touches storage only and has no database role to test. CI keeps only 10 pass annotations per step, so
  some passes are read from the step's exit status.
- The API still connects as `neondb_owner` in production, where RLS may not apply. Moving to `connect_app` and
  `connect_worker` needs a separate worker pool and owner approval.
- SECURITY DEFINER functions and foreign key checks need the table owner to bypass RLS; unconfirmed in production.
- Deploy order: migrations 000013-000019 must be applied before this code, or the API fails.
- Behavior changes: guests are refused in institutional rooms; class rooms admit only their batch, faculty and admins;
  Google sign-in is refused until `GOOGLE_CLIENT_IDS` is set in production; regular participants may publish by default,
  and class rooms start with publishing off.

## Current phase: Phases 1-3 product scope

Done at API level and, where stated, in a browser: scheduling, passcodes, co-host, transfer, institution management,
recurring classes, attendance reports, policies and corrections. See `FEATURE_REGISTER.md` for each feature.

## Next action

In order: persisted chat and announcements (P1-08), polls and doubts (P3-07), notifications (P2-07), history search
(P2-02), admin dashboard (P2-08), engagement and browser signals (P3-05, P3-06), presentation (P2-04), whiteboard and
breakout rooms (P3-08). Add a LiveKit dev server to CI to exercise media. Recording stays blocked on quota.

## Not started or blocked

- Most product scope: see `FEATURE_REGISTER.md`. Docker Desktop is still absent; CI is the disposable database.
- Production role attributes, provider quotas, measured Redis latency: no read access yet.
