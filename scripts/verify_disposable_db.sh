#!/usr/bin/env bash
# Verifies migration 000010 and RLS behaviour on a local disposable PostgreSQL 16.
# All URLs are fixed to loopback and .env is never read, so production is unreachable.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE=(docker compose -f "${ROOT}/tests/docker-compose.pg16.yml")
MIGRATIONS="${ROOT}/connect-main/migrations"
UPGRADE_MARKER="upgrade-fixture"
PSQL=("${COMPOSE[@]}" exec -T postgres psql -U postgres -d connect_test -v ON_ERROR_STOP=1 -q)

unset DATABASE_URL DATABASE_DIRECT_URL DIRECT_URL
trap '"${COMPOSE[@]}" down -v >/dev/null 2>&1 || true' EXIT

"${COMPOSE[@]}" down -v >/dev/null 2>&1 || true
"${COMPOSE[@]}" up -d --wait

echo "== Step 1: apply migrations 000001-000009 (existing schema)"
for f in "${MIGRATIONS}"/00000[1-9]_*.sql; do
  "${PSQL[@]}" < "${f}"
done
"${PSQL[@]}" -c "ALTER ROLE connect_app PASSWORD 'disposable'; ALTER ROLE connect_worker PASSWORD 'disposable';"

echo "== Step 2: seed a pre-existing room, then upgrade to 000010"
"${PSQL[@]}" <<SQL
INSERT INTO users (id, email_normalized, display_name, password_hash)
VALUES ('00000000-0000-0000-0000-0000000000a1', '${UPGRADE_MARKER}@example.test', 'Fixture', 'x');
INSERT INTO rooms (public_code, host_user_id, workspace_type)
VALUES ('${UPGRADE_MARKER}', '00000000-0000-0000-0000-0000000000a1', 'personal_workspace');
SQL
"${PSQL[@]}" < "${MIGRATIONS}/000010_trusted_sessions_and_attendance_policies.sql"
"${PSQL[@]}" -tAc "SELECT count(*) FROM rooms WHERE public_code = '${UPGRADE_MARKER}'" | grep -qx 1
echo "PASS: existing data survived the upgrade"

echo "== Step 3: rollback and re-apply"
"${PSQL[@]}" < "${ROOT}/tests/sql/rollback_000010.sql"
"${PSQL[@]}" -tAc "SELECT to_regclass('participant_media_sessions') IS NULL" | grep -qx t
"${PSQL[@]}" < "${MIGRATIONS}/000010_trusted_sessions_and_attendance_policies.sql"
echo "PASS: rollback and re-apply"

echo "== Step 4: RLS tests under each restricted runtime role"
ADMIN="postgres://postgres:disposable@127.0.0.1:55432/connect_test?sslmode=disable"
STATUS=0
for role in connect_app connect_worker; do
  echo "-- role: ${role}"
  (cd "${ROOT}/connect-main/services/api" && \
    TEST_DATABASE_URL="${ADMIN}" \
    TEST_APP_DATABASE_URL="postgres://${role}:disposable@127.0.0.1:55432/connect_test?sslmode=disable" \
    go test -count=1 -v -run TestRLS_ ./internal/attendance) || STATUS=1
done

if [ "${STATUS}" -ne 0 ]; then
  echo "RESULT: FAILED. Keep the output: it is the RLS finding."
  exit 1
fi
echo "RESULT: migration and RLS checks passed"
