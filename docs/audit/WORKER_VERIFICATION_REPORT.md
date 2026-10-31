# BACKGROUND WORKER VERIFICATION REPORT

**Target Environment:** Production (`main`)
**Deployment Date:** 2026-10-31 / 2026-11-01
**Auditor:** Principal Software Architect & Production SRE
**Repository:** `https://github.com/anant9934/connect`
**Inspected Commit:** `49264bd8a11bd32edcc067f0487cc965f15f7d86`

---

## 1. Executive Summary

This audit assesses the runtime existence, operational correctness, and failure recovery of the transactional outbox background worker in the deployed Connect application.

**Finding:** The background outbox worker implementation exists as a Go package (`internal/worker`), but is **completely absent from runtime deployment**. No worker goroutine is spawned in `cmd/server/main.go`, and no independent background worker process is configured on Render. Furthermore, domain handlers currently do not enqueue background jobs into the `background_jobs` table.

---

## 2. Architectural Inspection & Evidence

### A. Process Topology Analysis
Inspection of the production entry points revealed:
- `connect-main/services/api/cmd/server/main.go`:
  - Starts HTTP server `server.New(cfg, logger, router)`.
  - Package `github.com/tathastu/connect/services/api/internal/worker` is **not imported** and **never initialized**.
- Render Service Configuration (`srv-dbj507nlk1mc73897go0`):
  - Configured as a single Web Service running `./server`.
  - No background worker process or secondary daemon service exists in Render.

### B. Outbox Enqueueing in Domain Logic
Grep analysis across the backend repository:
```bash
grep -rn "EnqueueJob" connect-main/services/api/
```
Output:
- Only found in `internal/worker/queue.go` and `internal/worker/worker_test.go`.
- Domain operations (such as room ending, user deletion, file cleanup, attendance recording) currently do not push transactional jobs to `background_jobs`.

---

## 3. Worker Capabilities Assessment

| Capability | In-Code Implementation | Deployed Runtime Status | Verdict |
| :--- | :--- | :--- | :--- |
| **Outbox Model** | `background_jobs` table with UUID, idempotency key, monotonic fencing token, status enum, retry count | Created via migration `000009_background_jobs_outbox.sql` | Schema Ready |
| **Lease Acquisition** | `SELECT ... FOR UPDATE SKIP LOCKED` with lease TTL and monotonic token increment | In code (`ClaimJobsWithLease`), passes unit tests | Not Running |
| **Worker Loop Execution** | Continuous polling loop or notification listener | Absent from `cmd/server/main.go` and no CLI worker | **ABSENT** |
| **Idempotency** | `ON CONFLICT (idempotency_key) DO NOTHING` | In code and schema constraint | Verified in Unit Tests |
| **Dead-Letter Handling** | Moves to `status = 'dead_letter'` when `attempt_count >= max_attempts` | In code (`FailJob`) | Verified in Unit Tests |
| **Lease Heartbeating** | Fencing token guarded heartbeat (`HeartbeatJob`) | In code | Verified in Unit Tests |

---

## 4. Failure Modes & Impact Analysis

1. **Pending Event Accumulation:**
   If any external component or future migration inserts rows into `background_jobs`, they will remain permanently stuck in `status = 'pending'` because no worker process is querying or claiming jobs.
2. **Database Reconnect Recovery:**
   `pgxpool.Pool` maintains internal reconnect recovery, but cannot be exercised by workers until a loop is implemented.
3. **Decoupled Asynchronous Tasks:**
   Operations requiring asynchronous retries (e.g., LiveKit room deletion webhooks, R2 batch cleanup, attendance email dispatch) are currently executed synchronously in HTTP requests or omitted.

---

## 5. Architectural Remediation Plan

To achieve production readiness for asynchronous workloads:
1. Implement a `WorkerRunner` in `internal/worker/runner.go` with context cancellation, jittered backoff polling, and panic recovery.
2. Instantiate `worker.StartRunner(ctx, pool, workerID)` in `cmd/server/main.go` during server startup, with graceful termination during OS signal handling.
3. Wire domain event outbox enqueueing (e.g., recording archiving, file purge, telemetry dispatch) through `worker.EnqueueJob(ctx, tx, ...)`.
