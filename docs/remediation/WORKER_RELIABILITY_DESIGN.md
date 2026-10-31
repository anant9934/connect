# Worker Reliability & Background Processing Architecture

## 1. Overview & Architectural Principles

Connect enforces a durable background processing model designed for high-concurrency educational workloads. Realtime classrooms generate bursty asynchronous operations—transcription requests, recording post-processing, automated attendance interval reconciliation, and external webhook handling (e.g., LiveKit Cloud events).

### Core Design Rules
1. **Durable Truth in PostgreSQL**: The primary database is the authoritative ledger. Redis is utilized strictly for ephemeral cache, rate limiting, and pub/sub signaling.
2. **Transactional Outbox Pattern**: Intersystem mutations (e.g., dispatching LiveKit egress, uploading recordings to S3, triggering external notifications) must never execute directly inside HTTP handlers. Instead, job definitions are inserted into the durable `background_jobs` / outbox table within the same transaction that updates domain state, eliminating dual-write divergence.
3. **At-Least-Once Delivery with Idempotent Workers**: All worker execution paths must be idempotent. Re-executing a job with the same parameters yields identical database state without side-effects or duplicated side-channel operations.
4. **Decoupled Failure Domains**: Failure of a background worker or downstream service (e.g., LiveKit API timeout, S3 transient 503) must not disrupt active WebRTC media streams, live classroom signaling, or primary HTTP request cycles.

---

## 2. Queue Topology & Concurrency Control

### Queue Tiers & Priority Assignment
| Queue Name | Priority | Concurrency Limit | Max Duration | Use Cases |
| :--- | :--- | :--- | :--- | :--- |
| `attendance_critical` | Tier 1 (High) | 50 workers | 30 seconds | Attendance interval reconciliation, connection event processing |
| `webhooks` | Tier 1 (High) | 40 workers | 15 seconds | LiveKit webhook ingestion, room event updates |
| `media_processing` | Tier 2 (Standard) | 10 workers | 15 minutes | Recording composition, MP4 transcode, S3 sync |
| `analytics_batch` | Tier 3 (Low) | 5 workers | 5 minutes | Daily attendance rollup, departmental audit logs |

### Keyset & Lease Concurrency
- **Concurrency Limiting**: Implemented via PostgreSQL advisory locks (`pg_try_advisory_xact_lock`) or table-level row leases using `FOR UPDATE SKIP LOCKED`.
- **Job Polling**: Workers poll via `SELECT id FROM background_jobs WHERE state = 'pending' AND scheduled_at <= NOW() ORDER BY priority DESC, id ASC LIMIT $1 FOR UPDATE SKIP LOCKED`.
- **Lease Expiration & Heartbeats**:
  - Running jobs update `heartbeat_at = NOW()` every 10 seconds.
  - If a worker crashes or partitions, a supervisory reaper marks jobs with `heartbeat_at < NOW() - INTERVAL '60 seconds'` as `failed_lease`, incrementing `attempt_count` for retry.

---

## 3. Idempotency & Distributed Deduplication

### Idempotency Key Specification
Every background job requires a deterministic `idempotency_key` constructed according to domain-specific inputs:
- **Attendance Reconciliation**: `sha256("attendance_reconcile:" || session_id || ":" || enrollment_id || ":" || scheduled_end)`
- **LiveKit Webhook Ingestion**: `sha256("livekit_event:" || webhook_event_id || ":" || event_type || ":" || participant_identity)`
- **Recording Upload**: `sha256("recording_upload:" || room_name || ":" || egress_id)`

### Deduplication Strategy
```sql
CREATE TABLE background_jobs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
    queue_name VARCHAR(64) NOT NULL,
    idempotency_key VARCHAR(64) NOT NULL UNIQUE,
    payload JSONB NOT NULL,
    state VARCHAR(32) NOT NULL DEFAULT 'pending',
    attempt_count INT NOT NULL DEFAULT 0,
    max_attempts INT NOT NULL DEFAULT 5,
    scheduled_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    locked_by VARCHAR(64),
    heartbeat_at TIMESTAMPTZ,
    last_error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_background_jobs_polling
ON background_jobs (queue_name, state, scheduled_at)
WHERE state IN ('pending', 'running');
```

---

## 4. Poison Pill Handling & Dead-Letter Queue (DLQ)

### Exponential Backoff with Decorrelated Jitter
When a worker encounters a transient error, it computes the next schedule time using full jitter to prevent thundering herd spikes:
$$\text{Delay} = \min\left(M_{\text{max}}, B \times 2^{\text{attempt}}\right) \pm \text{jitter}$$
- Base delay ($B$): 2 seconds.
- Max delay ($M_{\text{max}}$): 300 seconds.
- Jitter: Uniform random float in $[0, \text{Delay}]$.

### Poison Pill Isolation
1. **Retry Ceiling**: If `attempt_count >= max_attempts` (default: 5), the worker transitions the job state to `dead_letter`.
2. **Context Preservation**: The complete failure history, stack trace, and input payload are preserved in `dead_letter_jobs` with quarantine flags.
3. **Non-Blocking Operation**: A poisoned job never blocks subsequent jobs in the same queue due to `SKIP LOCKED` keyset pagination.
4. **Alerting**: Transitions to `dead_letter` trigger structured alerting emitted to Prometheus metrics (`connect_jobs_dead_letter_total`).

---

## 5. LiveKit Webhook Reconciliation & Unknown-State Preservation

Educational attendance and room tracking cannot rely solely on WebRTC webhook delivery due to network drops, server restarts, and out-of-order packet delivery.

### 1. Out-of-Order Webhook Handling
- **Symptom**: `participant_left` webhook arrives before `participant_joined` due to concurrent HTTP delivery paths.
- **Remediation**:
  - Webhooks insert raw events into `participant_connection_events` with the exact event timestamp emitted by LiveKit (`event_timestamp`), NOT `CURRENT_TIMESTAMP`.
  - The reconciliation engine sorts events strictly by `event_timestamp ASC`.
  - If a `participant_left` event is logged without a preceding `participant_joined` within the active session window, the engine preserves the connection event in `state = 'unpaired'` and initiates a reconciliation inquiry rather than discarding it.

### 2. Unknown-State Preservation & Periodic Polling
- **Principle**: If webhook delivery fails, a participant's attendance must **never** be silently marked as absent or truncated without verification.
- **LiveKit Server API Re-Sync**:
  - The attendance worker schedules an active room reconciliation check 5 minutes after session completion.
  - It queries the LiveKit Server SDK `RoomServiceClient.ListParticipants(room)` to verify active status.
  - If discrepancy exists between webhook logs and LiveKit RoomService records, the authoritative LiveKit RoomService metadata is reconciled into the immutable event ledger.

### 3. Graceful Heartbeat Expiry
- During active meetings, client frontends emit heartbeat pings every 30 seconds.
- If heartbeats cease without a clean `participant_left` event (e.g., sudden client browser crash or mobile device sleep):
  - A 90-second grace period is allowed.
  - If no heartbeat or reconnection event arrives within 90 seconds, a synthetic `disconnected_heartbeat_timeout` event is recorded, setting `ended_at = last_heartbeat + 30s`.

---

## 6. Transactional Outbox Implementation Guide

```go
// EnqueueTransactionalJob queues a background task within an existing DB transaction.
func EnqueueTransactionalJob(
    ctx context.Context,
    tx pgx.Tx,
    queueName string,
    idempotencyKey string,
    payload interface{},
) error {
    bytes, err := json.Marshal(payload)
    if err != nil {
        return fmt.Errorf("failed to marshal job payload: %w", err)
    }

    query := `
        INSERT INTO background_jobs (queue_name, idempotency_key, payload, state, scheduled_at)
        VALUES ($1, $2, $3, 'pending', NOW())
        ON CONFLICT (idempotency_key) DO UPDATE
        SET updated_at = NOW()
        WHERE background_jobs.state = 'pending';
    `
    _, err = tx.Exec(ctx, query, queueName, idempotencyKey, bytes)
    return err
}
```

This guarantees zero orphan jobs: if the database transaction rolls back, the background job never exists; if the transaction commits, the background job is guaranteed to be processed by the worker pool.
