#!/usr/bin/env bash
# ==============================================================================
# Atomic Git Engine - Pre-Commit Automated Quality Gates
# ==============================================================================
# Verifies commit readiness before any commit is finalized:
#   1. Git whitespace errors (trailing whitespace, space before tab, etc.)
#   2. Merge conflict markers (<<<<<<<, =======, >>>>>>>)
#   3. Accidentally staged secrets & sensitive credentials (.env, keys, tokens)
#   4. Accidental staging of large binary files
#   5. Lingering debug statements (debugger, breakpoint, pdb)
#   6. Project tech stack auto-detection and execution of existing test/lint suites
#   7. Staged diff integrity & non-empty staging check
# ==============================================================================

set -euo pipefail

# ANSI color codes
if [ -t 1 ]; then
  BOLD="\033[1m"
  GREEN="\033[0;32m"
  YELLOW="\033[0;33m"
  RED="\033[0;31m"
  CYAN="\033[0;36m"
  RESET="\033[0m"
else
  BOLD=""
  GREEN=""
  YELLOW=""
  RED=""
  CYAN=""
  RESET=""
fi

log_info()    { echo -e "${CYAN}ℹ [GATE]${RESET} $1"; }
log_pass()    { echo -e "${GREEN}✓ [PASS]${RESET} $1"; }
log_warn()    { echo -e "${YELLOW}⚠ [WARN]${RESET} $1"; }
log_fail()    { echo -e "${RED}✗ [FAIL]${RESET} $1" >&2; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKSPACE_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
cd "${WORKSPACE_ROOT}"

MODE="staged" # "staged" (default) or "working-tree"
SKIP_TESTS=false
VERBOSE=false

print_usage() {
  cat <<EOF
${BOLD}Atomic Git Engine — Quality Gate Validator${RESET}

Usage:
  ./scripts/git/health-check.sh [options]

Options:
  --pre-commit       Run as pre-commit hook (checks staged changes)
  --working-tree     Check all unstaged + staged changes in working tree
  --skip-tests       Skip project test suite execution
  --verbose          Verbose output
  --help, -h         Show this message
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --pre-commit)
      MODE="staged"
      shift
      ;;
    --working-tree)
      MODE="working-tree"
      shift
      ;;
    --skip-tests)
      SKIP_TESTS=true
      shift
      ;;
    --verbose)
      VERBOSE=true
      shift
      ;;
    -h|--help)
      print_usage
      exit 0
      ;;
    *)
      log_fail "Unknown argument: $1"
      print_usage
      exit 1
      ;;
  esac
done

# Ensure we are inside a Git repository
if ! git rev-parse --is-inside-work-tree &>/dev/null; then
  log_fail "Not inside a Git repository. Run ./scripts/git/setup.sh first."
  exit 1
fi

FAILURES=0
WARNINGS=0

echo -e "${BOLD}${CYAN}======================================================${RESET}"
echo -e "${BOLD}${CYAN}          ATOMIC GIT ENGINE QUALITY GATES             ${RESET}"
echo -e "${BOLD}${CYAN}======================================================${RESET}"

# ------------------------------------------------------------------------------
# Gate 1: Check Staged Files Presence (if in staged mode)
# ------------------------------------------------------------------------------
if [ "${MODE}" = "staged" ]; then
  STAGED_FILES="$(git diff --cached --name-only || true)"
  if [ -z "${STAGED_FILES}" ]; then
    log_warn "No changes are staged for commit."
    # If working tree is also clean, that's just empty
    if [ -z "$(git status --porcelain)" ]; then
      log_info "Working tree is clean. Nothing to validate."
      exit 0
    else
      log_warn "There are unstaged changes in the working tree, but staging area is empty."
      log_warn "Stage specific files using 'git add <path>' before committing."
      exit 0
    fi
  fi
  FILES_TO_CHECK="${STAGED_FILES}"
  DIFF_CMD="git diff --cached"
else
  FILES_TO_CHECK="$(git diff --name-only; git ls-files --others --exclude-standard)"
  DIFF_CMD="git diff"
fi

# ------------------------------------------------------------------------------
# Gate 2: Blocked File Patterns (.env, credentials, private keys)
# ------------------------------------------------------------------------------
log_info "Checking for sensitive files and credentials..."

BLOCKED_PATTERNS=(
  "^\.env$"
  "^\.env\..+$"
  ".*\.pem$"
  ".*\.key$"
  ".*id_rsa.*"
  ".*id_ed25519.*"
  "^credentials\.json$"
  "^serviceAccountKey\.json$"
  "^\.npmrc$"
  ".*secret.*\.json$"
)

SENSITIVE_FOUND=false
while IFS= read -r file; do
  [ -z "${file}" ] && continue
  filename="$(basename "${file}")"
  # Safely allow documentation and template environment files
  if echo "${filename}" | grep -Eq '^\.env\.(example|sample|template)$'; then
    continue
  fi
  for pattern in "${BLOCKED_PATTERNS[@]}"; do
    if echo "${file}" | grep -Eq "${pattern}" || echo "${filename}" | grep -Eq "${pattern}"; then
      log_fail "BLOCKED SENSITIVE FILE DETECTED: ${file}"
      SENSITIVE_FOUND=true
      FAILURES=$((FAILURES + 1))
      break
    fi
  done
done <<< "${FILES_TO_CHECK}"

if [ "${SENSITIVE_FOUND}" = false ]; then
  log_pass "No sensitive credential files detected."
fi

# ------------------------------------------------------------------------------
# Gate 3: Secret Scanning in Staged Diff
# ------------------------------------------------------------------------------
log_info "Scanning diff for hardcoded secret patterns..."

SECRET_FOUND=false
DIFF_CONTENT="$(${DIFF_CMD} -U0 || true)"

if [ -n "${DIFF_CONTENT}" ]; then
  # Scan added lines only (+ line, not +++ file header)
  ADDED_LINES="$(echo "${DIFF_CONTENT}" | grep '^\+[^+]' || true)"

  # Pattern 1: AWS Access Key
  if echo "${ADDED_LINES}" | grep -Eq 'AKIA[0-9A-Z]{16}'; then
    log_fail "Potential AWS Access Key ID detected in diff!"
    SECRET_FOUND=true
    FAILURES=$((FAILURES + 1))
  fi

  # Pattern 2: GitHub Personal Access Token
  if echo "${ADDED_LINES}" | grep -Eq 'gh[pous]_[A-Za-z0-9_]{36,255}'; then
    log_fail "Potential GitHub Token detected in diff!"
    SECRET_FOUND=true
    FAILURES=$((FAILURES + 1))
  fi

  # Pattern 3: Private Key Block (use -e to prevent dash flag interpretation)
  if echo "${ADDED_LINES}" | grep -Eq -e '-----BEGIN (RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----'; then
    log_fail "Private key block detected in diff!"
    SECRET_FOUND=true
    FAILURES=$((FAILURES + 1))
  fi

  # Pattern 4: Generic API Key / Secret assignments
  if echo "${ADDED_LINES}" | grep -Eiq '(api_key|apiKey|secret_key|secretKey|auth_token|authToken|private_key|bearer)\s*[:=]\s*["'\''][0-9a-zA-Z\-_]{16,}["'\'']'; then
    log_fail "High-entropy secret or API key assignment detected in diff!"
    SECRET_FOUND=true
    FAILURES=$((FAILURES + 1))
  fi

  # Pattern 5: JWT Token
  if echo "${ADDED_LINES}" | grep -Eq 'eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}'; then
    log_fail "JSON Web Token (JWT) detected in diff!"
    SECRET_FOUND=true
    FAILURES=$((FAILURES + 1))
  fi

  # Pattern 6: Slack Token
  if echo "${ADDED_LINES}" | grep -Eq 'xox[baprs]-[0-9a-zA-Z]{10,48}'; then
    log_fail "Slack API token detected in diff!"
    SECRET_FOUND=true
    FAILURES=$((FAILURES + 1))
  fi

  # Pattern 7: Database Connection String with Embedded Credentials
  if echo "${ADDED_LINES}" | grep -Eq '(postgres|postgresql|mysql|mongodb|redis):\/\/[a-zA-Z0-9_\-\.]+:[^@\s]+@'; then
    log_fail "Database connection string with embedded credentials detected in diff!"
    SECRET_FOUND=true
    FAILURES=$((FAILURES + 1))
  fi
fi

if [ "${SECRET_FOUND}" = false ]; then
  log_pass "Diff is clean of recognized secret patterns."
fi

# ------------------------------------------------------------------------------
# Gate 4: Merge Conflict Markers
# ------------------------------------------------------------------------------
log_info "Checking for unresolved merge conflict markers..."
CONFLICT_FOUND=false

while IFS= read -r file; do
  [ -z "${file}" ] && continue
  if [ -f "${file}" ]; then
    # Exact Git conflict markers:
    # 1. Start marker: <<<<<<< followed by space and ref/branch name
    # 2. Middle marker: exactly 7 '=' characters alone on line (allowing \r)
    # 3. End marker: >>>>>>> followed by space and ref/branch name
    if grep -Eq '^(<<<<<<< .+|=======(\r)?$|>>>>>>> .+)' "${file}" 2>/dev/null; then
      log_fail "Merge conflict marker found in: ${file}"
      CONFLICT_FOUND=true
      FAILURES=$((FAILURES + 1))
    fi
  fi
done <<< "${FILES_TO_CHECK}"

if [ "${CONFLICT_FOUND}" = false ]; then
  log_pass "No merge conflict markers detected."
fi

# ------------------------------------------------------------------------------
# Gate 5: Git Whitespace Errors
# ------------------------------------------------------------------------------
log_info "Checking for Git whitespace errors..."
if [ "${MODE}" = "staged" ]; then
  if ! git diff --cached --check &>/dev/null; then
    WS_ERR="$(git diff --cached --check || true)"
    log_warn "Git whitespace errors detected:"
    echo "${WS_ERR}" | head -n 10
    WARNINGS=$((WARNINGS + 1))
  else
    log_pass "Whitespace check passed (clean indentation and line endings)."
  fi
fi

# ------------------------------------------------------------------------------
# Gate 6: Large Accidental File Check (> 10MB)
# ------------------------------------------------------------------------------
log_info "Checking for oversized files (> 10MB)..."
LARGE_FILE_FOUND=false
while IFS= read -r file; do
  [ -z "${file}" ] && continue
  if [ -f "${file}" ]; then
    # Portable file size in bytes
    if [ "$(uname)" = "Darwin" ]; then
      FILESIZE="$(stat -f%z "${file}" 2>/dev/null || echo 0)"
    else
      FILESIZE="$(stat -c%s "${file}" 2>/dev/null || echo 0)"
    fi
    # 10 MB = 10485760 bytes
    if [ "${FILESIZE}" -gt 10485760 ]; then
      log_fail "Oversized file detected (${FILESIZE} bytes): ${file}"
      LARGE_FILE_FOUND=true
      FAILURES=$((FAILURES + 1))
    fi
  fi
done <<< "${FILES_TO_CHECK}"

if [ "${LARGE_FILE_FOUND}" = false ]; then
  log_pass "No oversized files detected."
fi

# ------------------------------------------------------------------------------
# Gate 7: Debugger / Console Leftover Warning
# ------------------------------------------------------------------------------
log_info "Checking for leftover debug statements..."
if [ -n "${DIFF_CONTENT}" ]; then
  ADDED_DEBUG="$(echo "${DIFF_CONTENT}" | grep '^\+[^+]' | grep -E '\b(debugger|breakpoint\(\)|pdb\.set_trace\(\))\b' || true)"
  if [ -n "${ADDED_DEBUG}" ]; then
    log_warn "Active debugger statement(s) detected in diff:"
    echo "${ADDED_DEBUG}" | head -n 5
    WARNINGS=$((WARNINGS + 1))
  else
    log_pass "No debugger statements found."
  fi
fi

# ------------------------------------------------------------------------------
# Gate 8: Tech Stack Auto-Detection and Verification
# ------------------------------------------------------------------------------
if [ "${SKIP_TESTS}" = false ]; then
  log_info "Detecting project tech stack and running available tests..."
  STACK_DETECTED=false

  # Node.js Stack
  if [ -f "package.json" ]; then
    STACK_DETECTED=true
    log_info "Node.js project detected (package.json present)."
    if command -v npm &>/dev/null; then
      # Check if lint script exists in package.json
      if python3 -c 'import json, sys; p=json.load(open("package.json")); sys.exit(0 if "lint" in p.get("scripts",{}) else 1)' 2>/dev/null; then
        log_info "Running npm run lint..."
        npm run lint || { log_fail "npm run lint failed"; FAILURES=$((FAILURES + 1)); }
      fi
      # Check if test script exists in package.json
      if python3 -c 'import json, sys; p=json.load(open("package.json")); sys.exit(0 if "test" in p.get("scripts",{}) else 1)' 2>/dev/null; then
        log_info "Running npm test..."
        npm test || { log_fail "npm test failed"; FAILURES=$((FAILURES + 1)); }
      fi
    else
      log_warn "npm not found in PATH; skipping Node.js script execution."
    fi
  fi

  # Python Stack
  if [ -f "pyproject.toml" ] || [ -f "setup.py" ] || [ -f "requirements.txt" ]; then
    STACK_DETECTED=true
    log_info "Python project detected."
    if command -v pytest &>/dev/null && [ -d "tests" ]; then
      log_info "Running pytest..."
      pytest || { log_fail "pytest failed"; FAILURES=$((FAILURES + 1)); }
    elif command -v python3 &>/dev/null && [ -d "tests" ]; then
      log_info "Running python3 -m unittest discover..."
      python3 -m unittest discover tests || { log_fail "unittest failed"; FAILURES=$((FAILURES + 1)); }
    fi
  fi

  # Go Stack
  if [ -f "go.mod" ]; then
    STACK_DETECTED=true
    log_info "Go project detected."
    if command -v go &>/dev/null; then
      go test ./... || { log_fail "go test failed"; FAILURES=$((FAILURES + 1)); }
    fi
  fi

  # Rust Stack
  if [ -f "Cargo.toml" ]; then
    STACK_DETECTED=true
    log_info "Rust project detected."
    if command -v cargo &>/dev/null; then
      cargo test || { log_fail "cargo test failed"; FAILURES=$((FAILURES + 1)); }
    fi
  fi

  if [ "${STACK_DETECTED}" = false ]; then
    log_info "No language-specific test harness detected. Skipped automated unit test suite."
  fi
fi

# ------------------------------------------------------------------------------
# Summary & Exit Code
# ------------------------------------------------------------------------------
echo -e "${BOLD}${CYAN}------------------------------------------------------${RESET}"
if [ "${FAILURES}" -gt 0 ]; then
  log_fail "Quality Gate validation FAILED with ${FAILURES} critical issue(s) and ${WARNINGS} warning(s)."
  exit 1
elif [ "${WARNINGS}" -gt 0 ]; then
  log_warn "Quality Gate PASSED with ${WARNINGS} warning(s)."
  exit 0
else
  log_pass "All Quality Gates PASSED successfully."
  exit 0
fi

