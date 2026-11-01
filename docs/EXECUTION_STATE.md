# Execution State

Compact checkpoint. Resume from here. Budget: free tier only.

**Branch:** `feat/trusted-attendance-foundation`. Never merge to `main` without owner approval.

## Verified infrastructure (read through APIs, 2026-11-02)

| Item | Evidence |
| :--- | :--- |
| Render | Service `connect`, plan **free**, region ohio, branch `main`, auto-deploy on, live commit `213d517` |
| Runtime DB role | `neondb_owner` through the pooler, not `connect_app` |
| Vercel | Project `connect`, root `connect-main/apps/web`, production branch `main` |

## Verified on disposable Postgres 16 (CI run 41358542181, commit `5015de5`)

- Migrations 000001-000014, SQL security suites, rollback and re-apply of 000010-000014.
- `TestWorkflowDB_ClassSessionAttendance`, `TestWorkflowDB_AuthContextIsolation` (as before).
- `TestWorkflowDB_NotesHTTP`, `TestWorkflowDB_FilesHTTP`: real routes as `connect_app`, two independent
  hosts, participants, guests, removed/left users, forged context, pool reuse. Session validation still
  uses the admin pool, and rooms are `personal_commons`; institutional rooms are not covered here.
- `TestWorkflowDB_WebhookHTTPBoundary`: missing, garbage, wrong-secret, tampered, malformed, replay.
- `TestWorkflowDB_AttendanceQueueLifecycle`: real `Runner` as `connect_worker`: duplicate enqueue, failure
  and retry, duplicate delivery, dead letter. Not covered: process restart mid-job.

Limits: SECURITY DEFINER helpers depend on the function owner bypassing RLS, unconfirmed in production.
Deploy order: migrations 000013 and 000014 must be applied before this code, or notes and files fail.

## Current phase: API request context

`notes` and `files` are converted. See `DB_CALL_SITE_REGISTER.md` for the rest.

## Next action

Convert `room`, using `WithRoomGuestContext` for guests and a narrow function for the pre-membership join
lookup. Then `auth` and `audit` through narrow definer functions, because they run before a session exists.
Only after that can the API role move to `connect_app` (needs owner approval).

## Not started or blocked

- Most product scope: see `FEATURE_REGISTER.md`. Docker Desktop is still absent; CI is the disposable database.
- Production role attributes, provider quotas, measured Redis latency: no read access yet.
