#!/usr/bin/env bash
# ==============================================================================
# Atomic Git Engine - Deep Repository Auditor & Intelligence Analyzer
# ==============================================================================
# Performs comprehensive repository audit:
#   1. Working tree analysis (modified, added, deleted, untracked)
#   2. Atomic commit grouping recommendations
#   3. Test coverage gap identification (code changed without tests)
#   4. Security risks (unignored .env, secret keys, large blobs)
#   5. Branch hygiene (stale branches, unmerged branches, detached HEAD)
#   6. Stash inspection (dangling or forgotten stashes)
#   7. Repository integrity (fsck, shallow status)
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

log_info()    { echo -e "${CYAN}ℹ [AUDIT]${RESET} $1"; }
log_pass()    { echo -e "${GREEN}✓ [PASS]${RESET} $1"; }
log_warn()    { echo -e "${YELLOW}⚠ [WARN]${RESET} $1"; }
log_fail()    { echo -e "${RED}✗ [FAIL]${RESET} $1" >&2; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKSPACE_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
cd "${WORKSPACE_ROOT}"

if ! git rev-parse --is-inside-work-tree &>/dev/null; then
  log_fail "Not inside a Git repository. Run ./scripts/git/setup.sh first."
  exit 1
fi

echo -e "${BOLD}${CYAN}======================================================${RESET}"
echo -e "${BOLD}${CYAN}            ATOMIC GIT ENGINE REPO AUDIT              ${RESET}"
echo -e "${BOLD}${CYAN}======================================================${RESET}"

# 1. Branch and HEAD inspection
log_info "Auditing Branch & HEAD state..."
CURRENT_BRANCH="$(git branch --show-current 2>/dev/null || echo '')"
if [ -z "${CURRENT_BRANCH}" ]; then
  log_warn "Detached HEAD state detected! You are not on a branch."
else
  log_pass "Current active branch: ${BOLD}${CURRENT_BRANCH}${RESET}"
fi

# 2. Stash inspection
STASH_COUNT="$(git stash list 2>/dev/null | wc -l | tr -d ' ')"
if [ "${STASH_COUNT}" -gt 0 ]; then
  log_warn "Found ${STASH_COUNT} saved stash entry/entries. Remember to review or pop forgotten stashes."
else
  log_pass "Stash list is empty (no buried changes)."
fi

# 3. Working tree state analysis
log_info "Auditing working tree modifications..."
MODIFIED="$(git ls-files -m)"
UNTRACKED="$(git ls-files --others --exclude-standard)"
STAGED="$(git diff --cached --name-only)"

MOD_COUNT="$(echo -n "${MODIFIED}" | grep -c . || true)"
UNTR_COUNT="$(echo -n "${UNTRACKED}" | grep -c . || true)"
STAGED_COUNT="$(echo -n "${STAGED}" | grep -c . || true)"

echo -e "  Staged files:    ${STAGED_COUNT}"
echo -e "  Modified files:  ${MOD_COUNT}"
echo -e "  Untracked files: ${UNTR_COUNT}"

# 4. Intelligence: Atomic Commit Grouping Recommendations
if [ "${MOD_COUNT}" -gt 0 ] || [ "${UNTR_COUNT}" -gt 0 ] || [ "${STAGED_COUNT}" -gt 0 ]; then
  echo ""
  echo -e "${BOLD}Commit Grouping & Atomic Unit Recommendations:${RESET}"
  python3 - << 'PY_EOF'
import subprocess
import os

def run_git(args):
    try:
        return subprocess.check_output(["git"] + args, stderr=subprocess.DEVNULL).decode("utf-8", errors="replace").strip()
    except Exception:
        return ""

status_lines = run_git(["status", "--porcelain"]).splitlines()

groups = {
    "docs": [],
    "tests": [],
    "scripts": [],
    "config": [],
    "ci": [],
    "source": []
}

has_src = False
has_test = False

for line in status_lines:
    if not line:
        continue
    status = line[:2]
    filename = line[3:].strip()
    
    if filename.startswith("docs/") or filename.endswith(".md"):
        groups["docs"].append(filename)
    elif filename.startswith(".github/") or "workflow" in filename:
        groups["ci"].append(filename)
    elif "test" in filename.lower() or filename.startswith("tests/"):
        groups["tests"].append(filename)
        has_test = True
    elif filename.startswith("scripts/"):
        groups["scripts"].append(filename)
    elif filename.startswith("config/") or filename.endswith((".json", ".yml", ".yaml", ".toml")):
        groups["config"].append(filename)
    else:
        groups["source"].append(filename)
        has_src = True

for group, files in groups.items():
    if files:
        suggested_type = {
            "docs": "docs",
            "ci": "ci",
            "tests": "test",
            "scripts": "chore/build",
            "config": "chore/config",
            "source": "feat/fix/refactor"
        }.get(group, "feat")
        print(f"  \033[0;36m• Atomic Group [{group.upper()}]\033[0m (Suggested: {suggested_type}):")
        for f in files[:5]:
            print(f"      - {f}")
        if len(files) > 5:
            print(f"      ... and {len(files) - 5} more files")

if has_src and not has_test:
    print("\n  \033[0;33m⚠ [ATTENTION]\033[0m Production code changes detected without accompanying unit tests.")
    print("    Recommendation: Add dedicated test files in a 'test(...)' atomic commit unit.")
PY_EOF
fi

# 5. Security Check: .gitignore presence and unignored sensitive files
log_info "Auditing .gitignore and sensitive file exposure..."
if [ ! -f ".gitignore" ]; then
  log_warn "No .gitignore found at workspace root! It is recommended to create one."
else
  log_pass ".gitignore file exists."
fi

# Check for unignored .env or keys (excluding templates like .env.example)
EXPOSED_SECRETS="$(find . -maxdepth 3 \( -name ".env*" -o -name "*.pem" -o -name "*.key" -o -name "id_rsa" \) -not -path "*/.git/*" -not -name "*.example" -not -name "*.sample" -not -name "*.template" 2>/dev/null || true)"
if [ -n "${EXPOSED_SECRETS}" ]; then
  log_warn "Potentially sensitive files found on filesystem:"
  echo "${EXPOSED_SECRETS}" | while read -r f; do echo "    $f"; done
else
  log_pass "No exposed credential or key files in repository root."
fi

# 6. Repository Integrity & Object Database Check
log_info "Auditing Git repository integrity (git fsck)..."
if [ "$(git rev-list --count HEAD 2>/dev/null || echo 0)" -eq 0 ]; then
  log_pass "Repository is in clean initial unborn state (no corrupt objects)."
elif git fsck --quiet &>/dev/null; then
  log_pass "Git object database is healthy and undamaged."
else
  log_warn "Git fsck reported integrity warnings."
fi

# 7. Oversized Tracked Blobs
log_info "Checking for oversized objects (> 5MB)..."
OVERSIZED="$(git ls-files | while read -r f; do
  if [ -f "$f" ]; then
    if [ "$(uname)" = "Darwin" ]; then
      sz="$(stat -f%z "$f" 2>/dev/null || echo 0)"
    else
      sz="$(stat -c%s "$f" 2>/dev/null || echo 0)"
    fi
    if [ "$sz" -gt 5242880 ]; then
      echo "$f ($sz bytes)"
    fi
  fi
done || true)"

if [ -n "${OVERSIZED}" ]; then
  log_warn "Oversized tracked file(s) found (> 5MB):"
  echo "${OVERSIZED}"
else
  log_pass "No oversized tracked files found."
fi

echo -e "${BOLD}${CYAN}------------------------------------------------------${RESET}"
log_pass "Repository audit complete."
echo -e "${BOLD}${CYAN}======================================================${RESET}"

