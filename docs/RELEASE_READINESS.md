# Connect Release Readiness

**Assessed:** 2026-11-01. **Verdict: NOT READY FOR RELEASE** against the five-phase scope.

This supersedes the "PRODUCTION-READY (BETA RELEASE)" verdict in
`docs/audit/PRODUCTION_READINESS_MATRIX.md` for that scope. That verdict covered the
meeting backend's infrastructure only. It did not cover classroom, lab or AI features.

## Why

- Phase 1 is partial. Phases 2 to 5 are almost entirely unbuilt (see `FEATURE_REGISTER.md`).
- The academic and attendance schema has no HTTP API, so no user can reach it.
- No end-to-end workflow (A to F) has an automated test.
- The Go toolchain pin (1.26.0) leaves 31 reachable standard-library vulnerabilities.
- The latest recorded latency (`/health/live` p95 1.67 s) misses the 300 ms read target,
  although the matrix marks it PASS. It measures an intercontinental path and has no load model.

## Verified on 2026-11-01

| Check | Result |
| :--- | :--- |
| `go build`, `go test ./...` | Pass, 16 packages with tests |
| Web typecheck and `node --test` | Pass, 57 tests |
| Mobile `node --test` | Pass, 145 tests |
| Live `GET /health/ready` on Render | `{"status":"ok"}` |
| `govulncheck` | 31 reachable standard-library vulnerabilities, fixed by newer Go releases |

## Not verified

- Migration `000010` has never been executed. No disposable PostgreSQL was available locally:
  Docker is absent and running downloaded Postgres binaries was blocked by the session's
  permission policy.
- All SQL in `PgxSessionStore` and the attendance reconciler is unexecuted for the same reason.
- Real LiveKit webhook delivery. The tests use locally signed events.
- Whether attendance works under FORCE ROW LEVEL SECURITY. The reconciler and webhook use the
  shared pool with no auth context. If the production role lacks BYPASSRLS, room lookups return
  no rows: webhooks are dropped as unknown rooms and reconciliation silently skips the class.
  The reconciler also still discards the error from its `rooms` lookup. Test this first.
- Android builds and device behaviour.
- Which Render plan is live. `render.yaml` says `starter`; the audit docs describe free tier.

## Rollout of the trusted-attendance branch

1. Run `000010` on a disposable database, then the `tests/sql` RLS suites.
2. Apply `000010` to production **before** deploying. The reconciler reads `attendance_policies`
   and its jobs fail until the table exists.
3. Deploy, then register `<api-origin>/api/v1/livekit/webhook` in LiveKit Cloud.
4. Hold a test class and compare `participant_media_sessions` with the LiveKit session view.

## Known limitations

- `class_sessions.actual_end` has no writer yet, so reconciliation uses the scheduled end.
- Reconciliation uses the latest policy version, so a re-run after a policy change re-evaluates
  non-overruled records. Pinning a version per class session is not implemented.
- Policies can only be created through SQL until an API exists.
- A webhook arriving after reconciliation updates sessions but does not trigger re-evaluation.
- Render services can sleep or restart: webhooks sent during downtime depend on LiveKit's
  retries, and worker latency has no guarantee.
