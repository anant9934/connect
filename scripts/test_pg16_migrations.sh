#!/usr/bin/env bash
# ==============================================================================
# Script: test_pg16_migrations.sh
# Purpose: Safe, production-gated PostgreSQL 16 test harness.
# Executes migrations 000001-000008, privilege assertions, and restricted-role
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
    version() || '|' ||
    (SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public');
" 2>&1) || {
  log_fail "Failed to connect to target database: ${IDENTITY_CHECK}"
  exit 1
}

CURRENT_DB=$(echo "${IDENTITY_CHECK}" | cut -d'|' -f1)
CURRENT_USER=$(echo "${IDENTITY_CHECK}" | cut -d'|' -f2)
PG_VERSION=$(echo "${IDENTITY_CHECK}" | cut -d'|' -f3)
TABLE_COUNT=$(echo "${IDENTITY_CHECK}" | cut -d'|' -f4)

log_info "Connected Target Database: ${CURRENT_DB}"
log_info "Connected User: ${CURRENT_USER}"
log_info "Server Engine: ${PG_VERSION}"
log_info "Pre-existing Public Tables: ${TABLE_COUNT}"

# Reject if connected to default 'postgres' database
if [ "${CURRENT_DB}" = "postgres" ]; then
  log_fail "BLOCKED: Target database is the default 'postgres' maintenance database. Please use a dedicated disposable test database."
  exit 1
fi

# Reject if database contains pre-existing application tables (> 25 tables indicates non-empty/shared DB)
if [ "${TABLE_COUNT}" -gt 25 ]; then
  log_fail "BLOCKED: Target database contains ${TABLE_COUNT} pre-existing tables. Aborting to prevent modifying a shared/live database."
  exit 1
fi

log_pass "Target identity verified. Database confirmed as disposable."

# ------------------------------------------------------------------------------
# 6. Execute Migrations 000001 - 000008 in Order
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
log_pass "GROUP 1 (Migrations 000001-000008): PASS"

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
