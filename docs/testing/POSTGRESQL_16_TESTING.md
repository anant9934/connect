# PostgreSQL 16 Migration & Security Testing Guide

## 1. Safety Harness (`scripts/test_pg16_migrations.sh`)
To guarantee that production and shared databases are never corrupted during test runs, Connect enforces a strict database safety harness:

```bash
# Permitted execution pattern (strictly isolated disposable target)
TEST_DATABASE_URL="postgres://postgres:postgres@localhost:5432/test_db" \
CONFIRM_DISPOSABLE_DB=true \
./scripts/test_pg16_migrations.sh
```

### 1.1 Failsafe Rules
- The script checks for `TEST_DATABASE_URL`. It NEVER falls back to `DATABASE_URL`.
- If `CONFIRM_DISPOSABLE_DB=true` is not explicitly set, the harness refuses execution.
- If the target host matches production patterns (`connect.`, `supabase.co`, `neon.tech`), execution is blocked immediately.

---

## 2. Test Suites Executed

### 2.1 Schema Migrations & Syntax Validation
- Sequentially applies all migrations `000001_*.sql` through `000009_*.sql`.
- Validates clean execution on native PostgreSQL 16.

### 2.2 Privilege Assertions (`tests/sql/privilege_and_rls_assertions.sql`)
- Verifies `connect_app` and `connect_worker` exist with `NOSUPERUSER NOBYPASSRLS`.
- Verifies zero table privileges on `connect_auth.internal_keys`.
- Verifies `FORCE ROW LEVEL SECURITY` across all 15 protected tables.
- Verifies absence of `PUBLIC` schema creation rights.

### 2.3 Restricted Role Adversarial Tests (`tests/sql/restricted_role_security_tests.sql`)
- Runs under `SET ROLE connect_app;`.
- Simulates token forgery, GUC tampering, cross-tenant leaks, and unauthorized updates.
- Proves 100% fail-closed behavior under the unprivileged runtime role.
