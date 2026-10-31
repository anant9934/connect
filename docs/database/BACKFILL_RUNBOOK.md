# Room Tenancy & Workspace Classification Backfill Runbook

## 1. Purpose & Strategy
The tenancy backfill worker (`connect-main/services/api/cmd/backfill_tenancy`) classifies pre-existing unclassified legacy rooms, meeting notes, and files into the four-tier workspace model without blocking live application traffic.

```text
Batch Size       : 1000 rooms per transaction
Throttle Delay   : 50ms between batches
Checkpoint Table : migration_checkpoints (task_name, last_processed_id, rows_processed)
```

---

## 2. Classification Logic & Anti-Assumption Rules
- **Institutional**: Identified by non-null `class_session_id`. Retains parent academic session organization ID.
- **Personal Commons**: Identified by collaboration node flags or public webinar settings (`organization_id = 00000000-0000-0000-0000-000000000001`).
- **Personal Workspace**: Private sandbox strictly owned by an unambiguous, verified host user with zero institutional conflicts.
- **Quarantined (`quarantine_unclassified`)**: Any room with missing host, corrupted foreign keys, or ambiguous attribution is locked (`is_locked = true`) and quarantined. It is NEVER exposed in Personal Commons.

---

## 3. Operational Execution

### 3.1 Running the Backfill
```bash
DATABASE_URL="postgres://user:pass@host:5432/dbname" go run ./connect-main/services/api/cmd/backfill_tenancy
```

### 3.2 Keyset Pagination & Resumability
- Batches use monotonic keyset ordering: `WHERE id > cursor_id AND (workspace_type IS NULL OR workspace_type = '' OR workspace_type = 'unclassified') ORDER BY id ASC LIMIT 1000`.
- The last successfully processed UUID is written to `migration_checkpoints`.
- If the backfill process is terminated, re-running the command automatically resumes from the saved checkpoint.
