# Neon Rehearsal Plan

**Status: not run. No results exist yet.** Do not treat anything here as evidence until the results table is filled in.

Run this on an isolated Neon branch with owner approval. It reads no production data beyond what the branch copies, and
changes nothing on the production branch. Neon branches are copy-on-write, so one short-lived branch should stay within
the free plan, but check the project's branch and compute limits first.

## 1. Create and verify isolation

1. Create a branch of production named `rehearsal-role-separation`, from the Neon console.
2. Use only that branch's connection strings. The compute host names must differ from production's.
3. On the branch, confirm you are not on the default branch: in the Neon console the branch must show as non-primary, and
   its endpoint ID must differ from the production endpoint ID. Record both IDs.
4. Write a marker on the branch and confirm production does not have it:
   `CREATE TABLE rehearsal_marker(id int);` on the branch, then `SELECT to_regclass('rehearsal_marker');` on production
   must return NULL. Drop the marker afterwards.

## 2. Record the starting point

`MIGRATION_DATABASE_URL=<branch owner URL> run_migration status`, row counts for `users`, `rooms`, `room_participants`,
`meeting_notes` and `meeting_files`, and `SELECT workspace_type, count(*) FROM rooms GROUP BY 1`. Rooms with a NULL
`workspace_type` cannot be read through the RLS paths and may need `backfill_tenancy` first.

## 3. Migrations against representative data

Apply each migration from `000013` onwards one at a time, noting duration and any error. The newest one is whatever
`RequiredMigration` names in `internal/database/identity.go`. Confirm row counts are unchanged afterwards.

## 4. Old code against the migrated schema

Run commit `213d517` locally against the branch, as the owner, as production does today. Exercise signup, login, create and
join a room, notes, files, lock, end. Anything failing here means migrations cannot go ahead of the code deploy.

## 5. New code through the Neon pooler

1. Set branch-only passwords on `connect_app` and `connect_worker`. Branch role passwords must differ from production's.
2. Run the current commit with `DATABASE_URL` as `connect_app` and `WORKER_DATABASE_URL` as `connect_worker`, both using the
   branch's **pooled** host, `APP_ENV=production` and `WORKER_ENABLED=true`.
3. Confirm the logs show `database_identity_verified` for both roles, then repeat the journeys above and end a meeting to
   confirm its jobs complete.
4. Check for failures specific to transaction pooling, especially prepared statements.

## 6. RLS and tenant isolation

Point the test suite at the branch with `TEST_DATABASE_URL`, `TEST_CONNECT_APP_URL` and `TEST_CONNECT_WORKER_URL`, and run
`go test -p 1 -run 'TestWorkflowDB_' ./internal/... ./cmd/...`. These tests create their own tenants and data, so only run
them on a branch that will be deleted. With real data present, also confirm `connect_app` sees no rows without a context.

## 7. Rollback limits to record

Run `tests/sql/rollback_*.sql` in reverse order on the branch. Known limits: `rollback_000020.sql` and later drop tables and
so delete anything written since. In production, rollback should normally mean redeploying old code and leaving additive
migrations in place. Rolling back the schema is a last resort that needs a restore point.

## 8. Clean up

Delete the branch and any local copies of its connection strings.

## Results

| Check | Result | Evidence |
| :--- | :--- | :--- |
| Branch isolated from production | Not run | |
| Migrations apply to production-shaped data | Not run | |
| Old commit works on migrated schema | Not run | |
| New roles work through the pooler | Not run | |
| RLS and tenant isolation on branch | Not run | |
| Rollback limits recorded | Not run | |
