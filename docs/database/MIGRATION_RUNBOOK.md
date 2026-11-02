# Database Migration Runbook (Migrations 000001 - 000009)

## 1. Migration Execution Overview
Database migrations are applied using the built-in Go CLI migration runner (`connect-main/services/api/cmd/run_migration`) or direct `psql` pipelines. Every migration script executes within an individual transaction and is protected against concurrent execution via session advisory locking.

```text
Advisory Lock ID: 742910482 (pg_try_advisory_lock)
Metadata Table  : schema_metadata (version, description, applied_at, execution_time_ms)
```

---

## 2. Standard Operating Procedures

Run these from an operator machine, using the direct (non-pooler) connection of the role that owns the schema. The tools
read only `MIGRATION_DATABASE_URL` and refuse `connect_app` and `connect_worker`. The owner role never goes on a runtime service.

### 2.1 Checking Migration Status
```bash
MIGRATION_DATABASE_URL="postgres://migration_role:pass@host:5432/dbname" go run ./connect-main/services/api/cmd/run_migration status
```

### 2.2 Applying Pending Migrations
```bash
MIGRATION_DATABASE_URL="postgres://migration_role:pass@host:5432/dbname" go run ./connect-main/services/api/cmd/run_migration up
```

---

## 3. Migration Sequence Inventory
1. `000001_init_schema.sql`: Core tables, users, metadata, session storage.
2. `000002_auth_and_rooms.sql`: Room definitions, participants, tokens.
3. `000003_waiting_room_and_history.sql`: Waiting room states, meeting logs.
4. `000004_meeting_notes_and_files.sql`: Collaborative notes, file attachment metadata.
5. `000005_user_profile_and_providers.sql`: User profile fields, OAuth identity providers.
6. `000006_participant_distributed_locks.sql`: Participant leases, monotonic counters.
7. `000007_tenancy_and_academic_core.sql`: Institutional tenancy, departments, courses, batches, enrollments, sessions.
8. `000008_auth_context_and_rls.sql`: Cryptographic HMAC context, role provisioning (`connect_app`, `connect_worker`), 15-table RLS matrix.
9. `000009_background_jobs_outbox.sql`: Transactional background jobs outbox, monotonic fencing leases, dead-letter queue.

---

## 4. Rollback & Disaster Recovery
- Each migration is executed inside a database transaction (`BEGIN ... COMMIT`).
- On syntax or execution error, the transaction automatically rolls back.
- If a manual rollback is required:
  1. Inspect `schema_metadata` for the last applied version.
  2. Execute the corresponding reverse DDL script against an isolated staging environment before applying to production.
