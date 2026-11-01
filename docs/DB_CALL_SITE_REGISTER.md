# Database Call-Site Register

Scanned from non-test code on `feat/trusted-attendance-foundation`. Counts are direct pool or
connection calls. Production still runs as `neondb_owner` until the owner approves moving to `connect_app`.

| File | Functions | Classification | Status | Test evidence |
| :--- | :--- | :--- | :--- | :--- |
| `internal/notes/repository.go` | `GetByRoomID`, `UpsertNote`, `ValidateRoomAccess` | Tenant-sensitive API | Converted: users via `WithAuthContext`, guests via narrow functions | `TestWorkflowDB_NotesHTTP` |
| `internal/files/repository.go` (7) | `CreateFile`, `GetFileByID`, `GetFilesByRoomID`, `GetFileCountByRoomID`, `DeleteFile` | Tenant-sensitive API | **Not converted** | None under `connect_app` |
| `internal/files/repository.go` | `UpdateScanStatus` | Worker-only | Not converted; needs a `connect_worker` policy check | None |
| `internal/room/repository.go` (26) | Room and participant lifecycle, history | Tenant-sensitive API | **Not converted** | None under `connect_app` |
| `internal/auth/repository.go` (13) | Users and session lookup | Global: runs before any session exists | Needs narrow definer functions, not `WithAuthContext` | None under `connect_app` |
| `internal/audit/service.go` (1) | `Record` | Global: append-only | Needs an insert-only grant check | None under `connect_app` |
| `internal/attendance/webhook.go` (1) | `Apply` | Webhook-only | Restricted: runs as `connect_app` | `TestWorkflowDB_WebhookHTTPBoundary` |
| `internal/worker/handlers_default.go` (13) | Job handlers | Worker-only | Attendance handler restricted; other handlers untested as `connect_worker` | `TestWorkflowDB_AttendanceQueueLifecycle` |
| `internal/worker/queue.go` (7) | Queue operations | Worker-only | Restricted | `TestWorkflowDB_AttendanceQueueLifecycle` |
| `internal/database/db.go` (2), `context.go` (1) | Transaction helpers | Infrastructure | Correct as is | `TestWorkflowDB_AuthContextIsolation` |
| `cmd/backfill_tenancy`, `run_migration` | One-off operators | Administrative | Correct: owner credentials, never the API | Unit tests only |
| `cmd/inspect_db`, `verify_worker` | Diagnostics | Administrative | Correct: operator-run | None |

Matches for `.Query` in `internal/files/handler.go`, `notes/handler.go`, `room/handlers.go`,
`meeting/p2p/handler.go` and `auth/identity_context.go` are URL query parameters, not SQL.
