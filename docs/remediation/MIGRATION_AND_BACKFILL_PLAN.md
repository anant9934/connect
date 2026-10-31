# MIGRATION & BACKFILL OPERATIONAL PLAYBOOK

## 1. Safe Expand-Contract Migration Architecture

```mermaid
sequenceDiagram
    autonumber
    actor Pipeline as Deployment Pipeline
    participant DB as PostgreSQL 16
    participant AppOld as Go API v1.0 (Live)
    participant Worker as Keyset Backfill Worker
    participant AppNew as Go API v1.1 (Canary)

    Note over Pipeline,DB: Step 1-5: Expand Phase (Zero Downtime, Sub-ms Locks)
    Pipeline->>DB: Apply 000007_tenancy_and_academic_core.sql (New Tables + NOT VALID FKs)
    DB-->>Pipeline: Applied in < 50ms without blocking live traffic

    Note over Worker,DB: Step 6-8: Restartable Keyset Backfill
    Worker->>DB: Run cmd/backfill_tenancy (1000 rows/batch, 50ms pause)
    DB-->>Worker: Backfill Complete (Quarantine isolated, Checkpoints updated)

    Note over Pipeline,DB: Step 9-11: Validate & Build Indexes Concurrently
    Pipeline->>DB: ALTER TABLE ... VALIDATE CONSTRAINT (SHARE UPDATE EXCLUSIVE - No writes blocked)
    Pipeline->>DB: CREATE INDEX CONCURRENTLY (Zero DML blocks)
    DB-->>Pipeline: Constraints validated; indexes active

    Note over Pipeline,AppNew: Step 12-14: Canary Rollout & Soak Period
    Pipeline->>AppNew: Deploy API v1.1 (Dual Read/Write aware)
    AppNew->>DB: Run health checks & verify RLS
    Pipeline->>AppOld: Drain and retire v1.0 instances
```

---

## 2. Evidence-Based Ownership Classification Matrix

| Entity | Relational Evidence Checked | Classification Target | Target `workspace_type` | Target `organization_id` | Quarantine Behavior |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **`rooms`** | `class_session_id IS NOT NULL` | **Institutional** | `'institutional'` | Retained from Class Session | Active |
| **`rooms`** | Linked to `collaboration_nodes` or public webinar | **Personal Commons** | `'personal_commons'` | `'00000000-0000-0000-0000-000000000001'` | Active |
| **`rooms`** | `host_user_id IS NOT NULL` without academic link | **Personal Workspace** | `'personal_workspace'` | `NULL` | Active |
| **`rooms`** | Missing/corrupted `host_user_id` and no session link | **Quarantine** | `'quarantine_unclassified'` | `NULL` | **Locked (`is_locked = true`); completely hidden from Commons** |
| **`meeting_notes`** | Inherited from parent `rooms(id)` | Matches Parent Room | Matches Parent Room | Matches Parent Room | Inherits parent quarantine |
| **`meeting_files`** | Inherited from parent `rooms(id)` | Matches Parent Room | Matches Parent Room | Matches Parent Room | Inherits parent quarantine |
| **Orphan Notes/Files**| Parent `room_id` deleted or corrupted | **Quarantine** | `'quarantine_unclassified'` | `NULL` | **Quarantined in storage** |

---

## 3. Detailed 17-Step Execution & Lock Analysis

| Step # | Operation | SQL Command / Tool | PostgreSQL Lock Mode | Table Scan? | Blocks DML? | Failure & Rollback Action |
|---|---|---|---|:---:|:---:|---|
| **1** | Logical Backup | `pg_dump --schema-only` | `ACCESS SHARE` | No | No | Retry backup. |
| **2** | Create Schema | `CREATE SCHEMA IF NOT EXISTS connect_auth` | `AccessExclusiveLock` (new schema) | No | No | Drop schema. |
| **3** | Create Academic Tables | `CREATE TABLE ... departments, courses...` | `AccessExclusiveLock` (new tables) | No | No | Drop new tables. |
| **4** | Add Nullable Columns | `ALTER TABLE rooms ADD COLUMN ... NULL` | `AccessExclusiveLock` ($\le 2\text{ms}$) | No | No | Metadata-only in PG 16; drop columns on rollback. |
| **5** | Add Foreign Keys | `ALTER TABLE ... ADD CONSTRAINT ... NOT VALID` | `AccessExclusiveLock` ($\le 5\text{ms}$) | No | No | Checks metadata only; drop constraint on failure. |
| **6** | Deploy Backfill Worker | `cmd/backfill_tenancy` (Batches of 1,000) | `RowExclusiveLock` (per batch) | Keyset | No | Restart worker; resumes from `last_processed_id`. |
| **7** | Backfill Notes & Files | `UPDATE meeting_notes ... FROM rooms` | `RowExclusiveLock` | Keyset | No | Re-run update script. |
| **8** | Quarantine Orphans | `UPDATE ... SET workspace_type = 'quarantine'` | `RowExclusiveLock` | Filtered | No | Re-run script. |
| **9** | Validate Constraints | `ALTER TABLE ... VALIDATE CONSTRAINT` | `SHARE UPDATE EXCLUSIVE` | Sequential | **NO** | Validates in background; drop constraint if invalid rows found. |
| **10**| Concurrent Indexes | `CREATE INDEX CONCURRENTLY` | `SHARE UPDATE EXCLUSIVE` | Sequential | **NO** | Drop invalid index with `DROP INDEX CONCURRENTLY` and retry. |
| **11**| Deploy RLS Policies | `000008_auth_context_and_rls.sql` | `AccessExclusiveLock` ($\le 5\text{ms}$) | No | No | Disable RLS with `ALTER TABLE ... DISABLE ROW LEVEL SECURITY`. |
| **12**| Deploy Canary API v1.1 | Kubernetes / Docker rolling deploy | None (Application layer) | No | No | Revert deployment traffic to v1.0. |
| **13**| Enable RLS on Rooms | `ALTER TABLE rooms ENABLE RLS` | `AccessExclusiveLock` ($\le 2\text{ms}$) | No | No | Disable RLS if regression observed. |
| **14**| 14-Day Production Soak | Continuous telemetry & lag monitoring | None | No | No | Allows forward writes under new schema. |
| **15**| Verify Zero Unclassified | `SELECT count(*) WHERE workspace_type IS NULL` | `ACCESS SHARE` | Index | No | Run catch-up backfill on remaining rows. |
| **16**| Enforce NOT NULL | `ALTER TABLE rooms ALTER COLUMN ... SET NOT NULL`| `AccessExclusiveLock` | No (if valid) | Sub-ms | Remove NOT NULL on failure. |
| **17**| Post-Deploy Verification | Automated test matrix suite | `ACCESS SHARE` | Index | No | Investigation alerts. |
