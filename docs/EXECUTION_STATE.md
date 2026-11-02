# Execution State

Compact checkpoint. Resume from here. Budget: free tier only.

**Branch:** `feat/trusted-attendance-foundation`. Never merge to `main` without owner approval.

## Verified infrastructure (read through APIs, 2026-11-02)

| Item | Evidence |
| :--- | :--- |
| Render | Service `connect`, plan **free**, region ohio, branch `main`, auto-deploy on, live commit `213d517` |
| Runtime DB role | `neondb_owner` through the pooler, not `connect_app`. Owner reports `rolbypassrls=true`, so RLS does not apply |
| Vercel | Project `connect`, root `connect-main/apps/web`, production branch `main` |

## Verified on disposable Postgres 16 (CI run 41376757634, commit `d72b46a`: database tests pass, real-media browser journey FAILS intermittently)

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

**Open defect, investigate first:** in `e2e_meeting_interaction.mjs`, clients log `negotiation timed out` and each user
collects 4-5 LiveKit sessions within minutes, so peers intermittently vanish. Some runs get through video, chat, reload,
announcements, hands, reactions, quizzes, doubts and co-host; the latest failed earlier, at reactions. Not yet known whether
this is CI load or a product bug. A transfer also added a session after connections had been stable for 12 seconds. Commit
`d72b46a` aligned permissions as a suspected fix, but no run has reached that check since, so it is unverified.
To separate them: reduce to two browsers without video, then read LiveKit's close reason, now reported in the annotations.

## Next action

1. Resolve the defect above and get the browser journey reliably green.
2. Android: the release APK builds and launches on the emulator (`Medium_Phone_API_37.0`), but it has no local backend to
   reach. Running meeting screens needs a local Postgres and API, which CI has but this machine does not. Android has no
   polls or doubts screen yet.
3. Then, in order: notifications (P2-07), history search (P2-02), admin (P2-08), engagement and browser signals
   (P3-05, P3-06), presentation (P2-04), whiteboard and breakout rooms (P3-08). Recording stays blocked on quota.

The Neon rehearsal is planned in `deployment/NEON_REHEARSAL_PLAN.md` and has not been run.

## Not started or blocked

- Most product scope: see `FEATURE_REGISTER.md`. Docker Desktop is still absent; CI is the disposable database.
- Production role attributes, provider quotas, measured Redis latency: no read access yet.
