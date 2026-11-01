# Database Call-Site Register

Scanned from non-test code on `feat/trusted-attendance-foundation`. Counts are direct pool or
connection calls. Production still runs as `neondb_owner` until the owner approves moving to `connect_app`.

| File | Functions | Classification | Status | Test evidence |
| :--- | :--- | :--- | :--- | :--- |
| `internal/notes/repository.go` | `GetByRoomID`, `UpsertNote`, `ValidateRoomAccess` | Tenant-sensitive API | Converted: users via `WithAuthContext`, guests via narrow functions | `TestWorkflowDB_NotesHTTP` |
| `internal/files/repository.go` | `CreateFile`, `GetFileByID`, `GetFilesByRoomID`, `UpdateScanStatus`, `DeleteFile` | Tenant-sensitive API | Converted: users via `WithAuthContext`, guests via `WithRoomGuestContext` | `TestWorkflowDB_FilesHTTP` |
| `internal/room/repository.go` | Room, participant, admission, lock, history methods | Tenant-sensitive API | Converted: session or guest context through `inTx` | `TestWorkflowDB_APITenantIsolation` |
| `internal/room/repository.go` | `GetRoomByCode`, `CanEnterRoom`, `GetActiveParticipantCount`, `IsParticipantRemoved` and guest writes | Pre-membership | Narrow `connect_auth` functions | `TestWorkflowDB_APITenantIsolation` |
| `internal/auth/repository.go` | User and session lookups, session touch and revoke | Global: runs before a session exists | Narrow `connect_auth` functions | `TestWorkflowDB_APITenantIsolation` |
| `internal/auth/repository.go` | `CreateUser`, `CreateSession` | Global: signup and login | Insert-only policy for `connect_app` | `TestWorkflowDB_APITenantIsolation` |
| `internal/auth/repository.go` | `UpdateProfile`, `UpdatePassword`, `LinkGoogleAccount`, `UpdatePreferences` | Tenant-sensitive API | Converted: own row in session context | Profile covered; password, Google and preferences are not |
| `internal/audit/service.go` | `Record` | Global: append-only | Insert-only for runtime roles; update and delete revoked | `TestWorkflowDB_APITenantIsolation` |
| `internal/attendance/webhook.go` (1) | `Apply` | Webhook-only | Restricted: runs as `connect_app` | `TestWorkflowDB_WebhookHTTPBoundary` |
| `internal/worker/handlers_default.go` (13) | Job handlers | Worker-only | Attendance handler tested; room cleanup and file purge not yet tested as `connect_worker` | `TestWorkflowDB_AttendanceQueueLifecycle` |
| `internal/worker/queue.go` (7) | Queue operations | Worker-only | Restricted | `TestWorkflowDB_AttendanceQueueLifecycle` |
| `internal/database/db.go` (2), `context.go` (1) | Transaction helpers | Infrastructure | Correct as is | `TestWorkflowDB_AuthContextIsolation` |
| `cmd/backfill_tenancy`, `run_migration` | One-off operators | Administrative | Correct: owner credentials, never the API | Unit tests only |
| `cmd/inspect_db`, `verify_worker` | Diagnostics | Administrative | Correct: operator-run | None |

Matches for `.Query` in `internal/files/handler.go`, `notes/handler.go`, `room/handlers.go`,
`meeting/p2p/handler.go` and `auth/identity_context.go` are URL query parameters, not SQL.
