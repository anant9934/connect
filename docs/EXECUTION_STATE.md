# Execution State

Compact checkpoint. Resume from here. Budget: free tier only.

**Branch:** `feat/trusted-attendance-foundation`. Never merge to `main` without owner approval.

## Verified infrastructure (read through APIs, 2026-11-02)

| Item | Evidence |
| :--- | :--- |
| Render | Service `connect`, plan **free**, region ohio, branch `main`, auto-deploy on, live commit `213d517` |
| Runtime DB role | `neondb_owner` through the pooler, not `connect_app`. Owner reports `rolbypassrls=true`, so RLS does not apply |
| Vercel | Project `connect`, root `connect-main/apps/web`, production branch `main` |

## Verified on disposable Postgres 16 (CI run 41380290532, commit `f6c8f91`: all database tests and browser journeys pass)

- Migrations 000001-000021, SQL security suites, rollback and re-apply of 000010-000021.
- `TestWorkflowDB_APITenantIsolation`: the full router with auth, room, notes and files all on `connect_app`:
  account lifecycle, room flow, forged leave and identity theft, waiting room, institutional rooms, suspended member,
  scheduled meetings, passcodes, co-hosts, host transfer including concurrent requests, account routes, Google checks.
- `TestWorkflowDB_InstitutionWorkflow`: institution to attendance report, two tenants, every role.
- `TestWorkflowDB_HostSuccession`, `TestWorkflowDB_RoomCleanupAsWorker`.
- Real Chrome against the built web app and API as `connect_app`: `e2e_schedule_passcode.mjs`, `e2e_institution.mjs`.
  `e2e_meeting_interaction.mjs` adds three browsers on a local LiveKit server, which proves the integration, not LiveKit Cloud.
- `TestWorkflowDB_MeetingInteraction`, `TestWorkflowDB_PollsQuizzesDoubts`.
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
- Production still connects as `neondb_owner`, which bypasses RLS. Role separation is coded and tested on this branch;
  applying it needs owner approval: `deployment/ROLE_SEPARATION_RELEASE.md`.
- SECURITY DEFINER functions and foreign key checks need the table owner to bypass RLS; unconfirmed in production.
- Deploy order: migrations 000013-000021 must be applied before this code, or the API fails.
- Behavior changes: guests are refused in institutional rooms; class rooms admit only their batch, faculty and admins;
  Google sign-in is refused until `GOOGLE_CLIENT_IDS` is set in production; regular participants may publish by default,
  and class rooms start with publishing off.

## Role separation

Code, tests and procedure are on this branch. `DATABASE_URL` is `connect_app`, `WORKER_DATABASE_URL` is `connect_worker`,
`MIGRATION_DATABASE_URL` is for tools only. Production enforces identity at startup, so merging without the coordinated
procedure would fail the deploy.

## Current phase: Phases 1-3 product scope

P1-08 and P3-07 are built and pass at API level. See `FEATURE_REGISTER.md`.

**Reconnect defect, resolved.** Cause: CI pinned `livekit-server:v1.9.0`, which `livekit-client` 2.22 cannot complete
negotiation with. The client hit its 15s `peerConnectionTimeout`, then did a full reconnect, for a new session each time.
Same test, same runner, load 0.89 on 4 CPUs: v1.9.0 gave 7 sessions per user in 100s; 1.13.11 gave 1, through camera and
transfer. The app created one Room per page load. It was not a product lifecycle defect, and `d72b46a` was not the fix.
Self-hosted LiveKit must be a compatible version. **LiveKit Cloud itself remains unverified.**

Regressions in `e2e_media_stability.mjs`, repeated 3 times in each CI run: stable media, role changes, transfer after a stable
connection, duplicate connects, a real server outage with recovery, reload, leave and rejoin, unmount cleanup.

## Next action

1. Android meeting, waiting room and role tests against a real backend, in a CI emulator job.
2. Android: the release APK builds and launches on the emulator (`Medium_Phone_API_37.0`), but it has no local backend to
   reach. Running meeting screens needs a local Postgres and API, which CI has but this machine does not. Android has no
   polls or doubts screen yet.
3. Then, in order: notifications (P2-07), history search (P2-02), admin (P2-08), engagement and browser signals
   (P3-05, P3-06), presentation (P2-04), whiteboard and breakout rooms (P3-08). Recording stays blocked on quota.

The Neon rehearsal is planned in `deployment/NEON_REHEARSAL_PLAN.md` and has not been run.

## Not started or blocked

- Most product scope: see `FEATURE_REGISTER.md`. Docker Desktop is still absent; CI is the disposable database.
- Production role attributes, provider quotas, measured Redis latency: no read access yet.
