# Connect Release Readiness

**Assessed:** 2026-11-01. **Verdict: NOT READY FOR RELEASE** against the five-phase scope.

This supersedes the "PRODUCTION-READY (BETA RELEASE)" verdict in
`docs/audit/PRODUCTION_READINESS_MATRIX.md` for that scope. That verdict covered the
meeting backend's infrastructure only. It did not cover classroom, lab or AI features.

## Why

- Phase 1 is partial. Phases 2 to 5 are almost entirely unbuilt (see `FEATURE_REGISTER.md`).
- The academic and attendance schema has no HTTP API, so no user can reach it.
- No end-to-end workflow (A to F) has an automated test.
- RLS behaviour under the runtime role is unverified, and no disposable database exists yet.
- The latest recorded latency (`/health/live` p95 1.67 s) misses the 300 ms read target,
  although the matrix marks it PASS. It measures an intercontinental path and has no load model.

## Verified on 2026-11-01

| Check | Result |
| :--- | :--- |
| `go build`, `go test ./...` | Pass, 16 packages with tests |
| Web typecheck and `node --test` | Pass, 57 tests |
| Mobile `node --test` | Pass, 145 tests |
| Live `GET /health/ready` on Render | `{"status":"ok"}` |
| `govulncheck` before upgrade | 31 reachable standard-library vulnerabilities |
| `govulncheck` after Go 1.26.10 | 0 reachable. GO-2026-5932 in `x/crypto` remains: not called by our code, no fix published |

## Blockers to the RLS gate

No disposable PostgreSQL exists: Docker Desktop, the approved route, is not installed. Once it is
running, `scripts/verify_disposable_db.sh` performs the checks. It has been syntax-checked only. Running
downloaded Postgres binaries and reading production catalogs were both blocked by this session's
permission policy and were not retried another way. `TestRLS_WebhookStoreUnderRuntimeRole` is written but has **never run**.

**Runtime role finding (Render API, 2026-11-02):** the API connects as `neondb_owner`, not
`connect_app`. If that role has BYPASSRLS, which is expected for a Neon owner but not confirmed by
catalog query, FORCE RLS has no effect and tenant isolation rests on application code alone.

**CI evidence (run 41338673459, disposable Postgres 16):** before `000011`, both `connect_app` and
`connect_worker` (bypassrls=false) failed the webhook and attendance job tests: real rooms are invisible
without an auth context. Migrations 000001-000010, the SQL security suites and `000010` rollback passed.

**After `000011` (run 41338955770):** those tests pass for webhook and worker paths. API-level tenant
isolation remains untested.

**Run 41343853509 (`82f9242`):** full class-session attendance workflow and transaction-scoped auth
context pass under restricted roles. No API route uses that context yet.

**Plan:** Render is confirmed Free. `render.yaml` differs from the live service in name and region
(`singapore` vs `ohio`), so do not sync the Blueprint from it.

## Go test accounting

The Go suite ends with 171 passed and 11 skipped. Skips are **not passes**: 5 PostgreSQL lock tests,
the new RLS test, 3 Redis tests, 1 R2 test and 1 worker lifecycle test, all needing live services.

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

## Production role separation

Code is ready on the branch; production is unchanged. Procedure, verification and rollback:
[`deployment/ROLE_SEPARATION_RELEASE.md`](deployment/ROLE_SEPARATION_RELEASE.md).

Checklist before release:

- [x] API and worker use separate pools and settings; the worker has no fallback.
- [x] Startup verifies the live role, privileges, memberships, ownership and RLS, and refuses in production.
- [x] Administrative tools use only `MIGRATION_DATABASE_URL` and refuse runtime roles.
- [x] Provisioning script no longer copies the API connection string.
- [ ] Remaining production role queries reviewed by the owner.
- [ ] Migrations rehearsed on a Neon branch of production data.
- [ ] Runtime role passwords set; settings configured; coordinated deployment run and verified.

Partial production result (owner, 2026-11-02): `neondb_owner` has `rolbypassrls=true`; `connect_app` and `connect_worker`
have neither superuser nor BYPASSRLS. **Production still connects as the owner as last read, so RLS does not protect it yet.**

## Production role verification (owner runs in the Neon SQL console; read-only)

```sql
SELECT rolname, rolsuper, rolbypassrls FROM pg_roles
WHERE rolname IN (current_user, 'neondb_owner', 'connect_app', 'connect_worker');

SELECT n.nspname, p.proname, pg_get_userbyid(p.proowner) AS owner, p.prosecdef
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'connect_auth' ORDER BY 2;

SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity, pg_get_userbyid(c.relowner) AS owner
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind = 'r' ORDER BY 1;

SELECT version FROM schema_metadata ORDER BY 1;
```

Also, for membership, attributes, live connections and table ownership:

```sql
WITH RECURSIVE reach AS (
  SELECT m.member, m.roleid, m.member AS start_role FROM pg_auth_members m
  WHERE m.member IN ('connect_app'::regrole, 'connect_worker'::regrole)
  UNION
  SELECT m.member, m.roleid, r.start_role FROM pg_auth_members m JOIN reach r ON m.member = r.roleid
)
SELECT r.start_role::regrole AS runtime_role, r.roleid::regrole AS reachable_role, a.rolsuper, a.rolbypassrls
FROM reach r JOIN pg_roles a ON a.oid = r.roleid ORDER BY 1, 2;

SELECT rolname, rolinherit, rolcreaterole, rolcreatedb, rolcanlogin, rolreplication
FROM pg_roles WHERE rolname IN ('connect_app', 'connect_worker');

SELECT usename, application_name, state, count(*) FROM pg_stat_activity
WHERE datname = current_database() GROUP BY 1, 2, 3 ORDER BY 1;

SELECT c.relname, pg_get_userbyid(c.relowner) AS owner
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
  AND pg_get_userbyid(c.relowner) IN ('connect_app', 'connect_worker');
```

`SECURITY DEFINER` helpers need their owner to have `rolsuper` or `rolbypassrls`. With `rolbypassrls` true for
the API's login role, RLS does nothing for it today, whatever the policies say.
