#!/usr/bin/env bash
# ==============================================================================
# Script: test_pg16_migrations.sh
# Purpose: Safe, production-gated PostgreSQL 16 test harness.
# Executes migrations 000001-000024, privilege assertions, and restricted-role
# security tests against an explicit, confirmed disposable test database.
# ==============================================================================

set -euo pipefail

BOLD="\033[1m"
GREEN="\033[0;32m"
YELLOW="\033[0;33m"
RED="\033[0;31m"
CYAN="\033[0;36m"
RESET="\033[0m"

log_info() { echo -e "${CYAN}ℹ [PG16-HARNESS]${RESET} $1"; }
log_pass() { echo -e "${GREEN}✓ [PASS]${RESET} $1"; }
log_fail() { echo -e "${RED}✗ [FAIL]${RESET} $1" >&2; }
log_warn() { echo -e "${YELLOW}⚠ [WARN]${RESET} $1"; }

# ------------------------------------------------------------------------------
# 1. Strict Target URL Verification (Zero Fallback to DATABASE_URL)
# ------------------------------------------------------------------------------
if [ -z "${TEST_DATABASE_URL:-}" ]; then
  log_fail "FATAL: TEST_DATABASE_URL environment variable is required."
  echo "Security Notice: Automatic fallback to DATABASE_URL has been permanently removed to prevent accidental execution on production/shared databases."
  echo "Usage: CONFIRM_DISPOSABLE_DB=true TEST_DATABASE_URL='postgres://user:pass@host:5432/disposable_db' ./scripts/test_pg16_migrations.sh"
  exit 1
fi

TARGET_URL="${TEST_DATABASE_URL}"

# ------------------------------------------------------------------------------
# 2. Explicit Disposable Environment Confirmation Gate
# ------------------------------------------------------------------------------
if [ "${CONFIRM_DISPOSABLE_DB:-}" != "true" ]; then
  log_fail "FATAL: Disposable environment confirmation missing."
  echo "You must explicitly confirm that this database target is disposable and non-production by setting CONFIRM_DISPOSABLE_DB=true."
  exit 1
fi

# ------------------------------------------------------------------------------
# 3. Static Safety Pattern Gating
# ------------------------------------------------------------------------------
if echo "${TARGET_URL}" | grep -Ei 'prod|production|live|supabase\.co' >/dev/null; then
  log_fail "BLOCKED: URL matches forbidden production keywords ('prod', 'production', 'live', 'supabase.co'). Execution aborted."
  exit 1
fi

# ------------------------------------------------------------------------------
# 4. Host Tooling Verification
# ------------------------------------------------------------------------------
if ! command -v psql >/dev/null 2>&1; then
  log_fail "Tooling missing: 'psql' binary is not installed or not in PATH."
  echo "PostgreSQL 16 verification requires a PostgreSQL client or disposable test container."
  exit 1
fi

# ------------------------------------------------------------------------------
# 5. Live Database Identity & Safety Assertions (Querying Target DB)
# ------------------------------------------------------------------------------
log_info "Connecting to target database to verify identity and safety..."

IDENTITY_CHECK=$(psql "${TARGET_URL}" -t -A -c "
SELECT
    current_database() || '|' ||
    current_user || '|' ||
    current_setting('server_version_num') || '|' ||
    (SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public') || '|' ||
    (SELECT rolsuper::text FROM pg_catalog.pg_roles WHERE rolname = current_user);
" 2>&1) || {
  log_fail "Failed to connect to target database: ${IDENTITY_CHECK}"
  exit 1
}

CURRENT_DB=$(echo "${IDENTITY_CHECK}" | cut -d'|' -f1)
CURRENT_USER=$(echo "${IDENTITY_CHECK}" | cut -d'|' -f2)
PG_VERSION_NUM=$(echo "${IDENTITY_CHECK}" | cut -d'|' -f3)
TABLE_COUNT=$(echo "${IDENTITY_CHECK}" | cut -d'|' -f4)
IS_SUPERUSER=$(echo "${IDENTITY_CHECK}" | cut -d'|' -f5)

log_info "Connected Target Database: ${CURRENT_DB}"
log_info "Connected User: ${CURRENT_USER}"
log_info "PostgreSQL server_version_num: ${PG_VERSION_NUM}"
log_info "Pre-existing Public Tables: ${TABLE_COUNT}"
log_info "Connected role superuser: ${IS_SUPERUSER}"

# Fixture setup deliberately runs under a trusted superuser; the attack phase
# switches to connect_app. A non-superuser setup role cannot bypass FORCE RLS.
if [ "${IS_SUPERUSER}" != "true" ]; then
  log_fail "BLOCKED: PG16 harness requires a disposable PostgreSQL superuser for migration and fixture setup."
  exit 1
fi

# Require an explicitly named disposable database. This is an additional guard,
# not a substitute for verifying the target in the cloud/provider console.
if [[ "${CURRENT_DB}" != connect_test_* ]]; then
  log_fail "BLOCKED: Disposable database name must begin with connect_test_."
  exit 1
fi

# Require PostgreSQL 16 exactly; do not merely print the server version.
if ! [[ "${PG_VERSION_NUM}" =~ ^[0-9]+$ ]] || [ "${PG_VERSION_NUM}" -lt 160000 ] || [ "${PG_VERSION_NUM}" -ge 170000 ]; then
  log_fail "BLOCKED: PostgreSQL 16 is required; detected server_version_num=${PG_VERSION_NUM}."
  exit 1
fi

# Require an empty public schema. Any existing table makes the target non-disposable
# for this migration-chain test and aborts before the first write.
if [ "${TABLE_COUNT}" -ne 0 ]; then
  log_fail "BLOCKED: Target database has ${TABLE_COUNT} pre-existing public tables; expected an empty disposable database."
  exit 1
fi

log_pass "Target identity verified. Database confirmed as disposable."

# ------------------------------------------------------------------------------
# 6. Execute Migrations 000001 - 000024 in Order
# ------------------------------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
MIGRATIONS_DIR="${REPO_ROOT}/connect-main/migrations"
SQL_TESTS_DIR="${REPO_ROOT}/tests/sql"

MIGRATIONS=(
  "000001_init_schema.sql"
  "000002_auth_and_rooms.sql"
  "000003_waiting_room_and_history.sql"
  "000004_meeting_notes_and_files.sql"
  "000005_user_profile_and_providers.sql"
  "000006_participant_distributed_locks.sql"
  "000007_tenancy_and_academic_core.sql"
  "000008_auth_context_and_rls.sql"
  "000009_background_jobs_outbox.sql"
  "000010_trusted_sessions_and_attendance_policies.sql"
  "000011_service_role_access.sql"
  "000012_fix_allocation_policy_recursion.sql"
  "000013_room_participant_access.sql"
  "000014_room_guest_context.sql"
  "000015_room_rls_and_entry_rules.sql"
  "000016_auth_and_audit_rls.sql"
  "000017_scheduled_meetings_and_passcodes.sql"
  "000018_cohost_and_host_transfer.sql"
  "000019_institution_management.sql"
  "000020_meeting_interaction.sql"
  "000021_polls_quizzes_doubts.sql"
  "000022_notifications.sql"
  "000023_meeting_search.sql"
  "000024_admin_dashboard.sql"
)

echo ""
echo "======================================================"
echo "          GROUP 1: MIGRATION CHAIN EXECUTION          "
echo "======================================================"
for mig in "${MIGRATIONS[@]}"; do
  log_info "Applying migration: ${mig}..."
  psql "${TARGET_URL}" -v ON_ERROR_STOP=1 -f "${MIGRATIONS_DIR}/${mig}" > /dev/null
  log_pass "Migration ${mig} applied successfully."
done
log_pass "GROUP 1 (Migrations 000001-000024): PASS"

# ------------------------------------------------------------------------------
# 7. Execute Privilege & Role Assertions
# ------------------------------------------------------------------------------
echo ""
echo "======================================================"
echo "          GROUP 2: PRIVILEGE & ROLE ASSERTIONS        "
echo "======================================================"
psql "${TARGET_URL}" -v ON_ERROR_STOP=1 -f "${SQL_TESTS_DIR}/privilege_and_rls_assertions.sql"
log_pass "GROUP 2 (Privilege & RLS Assertions): PASS"

# ------------------------------------------------------------------------------
# 8. Execute Restricted-Role Security Tests (Under connect_app)
# ------------------------------------------------------------------------------
echo ""
echo "======================================================"
echo "     GROUP 3: RESTRICTED-ROLE (connect_app) TESTS     "
echo "======================================================"
psql "${TARGET_URL}" -v ON_ERROR_STOP=1 -f "${SQL_TESTS_DIR}/restricted_role_security_tests.sql"
log_pass "GROUP 3 (Restricted-Role Security Tests): PASS"

echo ""
echo "======================================================"
log_pass "ALL TEST GROUPS COMPLETED SUCCESSFULLY!"
echo "======================================================"
