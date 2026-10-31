#!/usr/bin/env bash
# ==============================================================================
# Script: test_pg16_migrations.sh
# Purpose: Executes full migration chain (000001-000008) and test suites against
# a disposable PostgreSQL 16 test database.
# ==============================================================================

set -euo pipefail

# ANSI color codes
BOLD="\033[1m"
GREEN="\033[0;32m"
YELLOW="\033[0;33m"
RED="\033[0;31m"
CYAN="\033[0;36m"
RESET="\033[0m"

log_info() { echo -e "${CYAN}ℹ [PG16-TEST]${RESET} $1"; }
log_pass() { echo -e "${GREEN}✓ [PASS]${RESET} $1"; }
log_fail() { echo -e "${RED}✗ [FAIL]${RESET} $1" >&2; }

TARGET_URL="${TEST_DATABASE_URL:-${DATABASE_URL:-}}"

if [ -z "${TARGET_URL}" ]; then
  log_fail "No test database URL provided. Set TEST_DATABASE_URL before running."
  echo "Usage: TEST_DATABASE_URL='postgres://user:pass@host:5432/disposable_db' ./scripts/test_pg16_migrations.sh"
  exit 1
fi

# Production Safety Assertion: Prevent running against production
if echo "${TARGET_URL}" | grep -Ei 'prod|production|live' >/dev/null; then
  log_fail "BLOCKED: Safety guard prevented execution against a production-designated database URL!"
  exit 1
fi

log_info "Connecting to disposable database target..."

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

log_info "Executing migrations 000001-000008 sequentially..."
for mig in "${MIGRATIONS[@]}"; do
  log_info "Applying migration: ${mig}..."
  if command -v psql >/dev/null 2>&1; then
    psql "${TARGET_URL}" -v ON_ERROR_STOP=1 -f "${MIGRATIONS_DIR}/${mig}"
  else
    log_fail "psql command not found on host. Install postgresql-client to execute migration verification."
    exit 1
  fi
  log_pass "Migration ${mig} applied successfully."
done

log_info "Executing Privilege and RLS Assertions..."
psql "${TARGET_URL}" -v ON_ERROR_STOP=1 -f "${SQL_TESTS_DIR}/privilege_and_rls_assertions.sql"
log_pass "Privilege and RLS assertions passed!"

log_info "Executing HMAC Security Attack Scenarios..."
psql "${TARGET_URL}" -v ON_ERROR_STOP=1 -f "${SQL_TESTS_DIR}/hmac_security_attack_scenarios.sql"
log_pass "All 7 HMAC adversarial attack scenarios defended!"

log_pass "ALL POSTGRESQL 16 INTEGRATION VERIFICATION TESTS PASSED SUCCESSFULLY!"
