# Role Separation Release Procedure

For a future coordinated deployment. **Nothing here has been run against production.** Every production step needs owner
approval. Connection strings and passwords stay out of chat, logs and Git.

## Identities

| Setting | Role | Used by | Where it is set |
| :--- | :--- | :--- | :--- |
| `DATABASE_URL` | `connect_app` | API pool | Render service |
| `WORKER_DATABASE_URL` | `connect_worker` | Worker pool, in the same process or `cmd/worker` | Render service |
| `MIGRATION_DATABASE_URL` | Schema owner (`neondb_owner`) | `run_migration`, `backfill_tenancy`, `inspect_db`, `verify_worker` | Operator machine only |

The owner must keep `BYPASSRLS`: the `SECURITY DEFINER` functions and foreign key checks depend on it.

## Why the order matters

- The live commit cannot run as `connect_app`: RLS would hide nearly everything, so changing `DATABASE_URL` alone is an outage.
- New code cannot run as the owner in production: it exits at startup, before serving traffic.
- New code needs migrations through `000019`, and its startup check refuses to run without them.

So code and connection settings change in one deploy, after the migrations.

## Rehearsal (strongly recommended)

Create a Neon branch of production and run steps 1, 3 and 5 against it, with the old code connected as the owner to confirm
the migrations do not break it. Migrations have only run on empty disposable databases, not on a copy of production data.

## Sequence

1. **Credentials.** As the owner, set a password on each runtime role without placing it in shell history or logs, for
   example with `\password connect_app` and `\password connect_worker` in `psql`. Take a Neon restore point first. Then
   confirm with the role queries in `RELEASE_READINESS.md` that neither can reach a privileged role and neither owns a table.
2. **Migrations.** `MIGRATION_DATABASE_URL=... run_migration status`, then `up`, from an operator machine. Applying them
   before the deploy is safe only if the rehearsal showed the old code keeps working.
3. **Prepare the deploy.** Turn off Render auto-deploy, then merge, so the merge does not deploy by itself.
4. **API setting.** Set `DATABASE_URL` to the `connect_app` pooled connection string in Render, without deploying.
5. **Worker setting.** Set `WORKER_DATABASE_URL` to the `connect_worker` connection string. Set `GOOGLE_CLIENT_IDS`.
   Confirm `MIGRATION_DATABASE_URL` is absent.
6. **Deploy together.** Deploy the merged commit once, picking up steps 4 and 5. Expect a short outage on the free plan.
7. **Verify identity.** Logs must show `database_identity_verified` for both `connect_app` and `connect_worker`, and no
   `database_identity_rejected`. `/health/ready` must pass.
8. **Verify connections.** As the owner, `SELECT usename, application_name, count(*) FROM pg_stat_activity WHERE
   datname = current_database() GROUP BY 1, 2;` must show the runtime roles and no owner connection from the API.
9. **Verify behaviour.** Sign up, log in, create and join a meeting, end it, and confirm its jobs complete. With two test
   tenants, confirm one cannot read the other's rooms, notes, files, courses or attendance. Turn auto-deploy back on.

## Rollback

1. In Render, restore `DATABASE_URL` to its previous value and remove `WORKER_DATABASE_URL`, **and** redeploy commit
   `213d517` (or the previous live commit) in the same action. Neither change works without the other.
2. Leave migrations in place. They are additive, and the owner bypasses their policies. If the rehearsal showed otherwise,
   restore from the Neon restore point, which loses writes made since then, so that is an owner decision.
3. Afterwards, change the runtime role passwords if they were exposed at any point.

## If startup is refused

`database_identity_rejected` lists each problem by role or table, never a credential:

| Message | Fix |
| :--- | :--- |
| connected as X, expected Y | The setting holds the wrong role's connection string |
| has BYPASSRLS, superuser or CREATEROLE | `ALTER ROLE ... NOBYPASSRLS NOSUPERUSER NOCREATEROLE` |
| membership in privileged roles | `REVOKE` that membership |
| owns protected tables | `ALTER TABLE ... OWNER TO` the schema owner |
| migration not applied, or table lacks forced RLS | Apply migrations |
| can read rows with no identity set | Stop: RLS is not restricting this role. Investigate before retrying |
