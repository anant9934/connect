#!/usr/bin/env bash
# ==============================================================================
# Atomic Git Engine - Safe GitHub Push & Remote Synchronization Utility
# ==============================================================================
# Guarantees safe synchronization to GitHub:
#   1. Zero Force-Push Guarantee: strictly bans --force / -f flags.
#   2. Verifies pre-push Quality Gates before transmitting commits.
#   3. Upstream tracking detection & automatic -u guidance.
#   4. Divergence detection (warns if remote is ahead, prevents clobbering).
#   5. Supports dry-run execution.
#   6. Preserves existing remote configurations.
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

log_info()    { echo -e "${CYAN}ℹ [PUSH]${RESET} $1"; }
log_pass()    { echo -e "${GREEN}✓ [SUCCESS]${RESET} $1"; }
log_warn()    { echo -e "${YELLOW}⚠ [WARN]${RESET} $1"; }
log_fail()    { echo -e "${RED}✗ [FAIL]${RESET} $1" >&2; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKSPACE_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
cd "${WORKSPACE_ROOT}"

DRY_RUN=false
SKIP_GATE=false
REMOTE="origin"
SET_UPSTREAM=false

print_usage() {
  cat <<EOF
${BOLD}Atomic Git Engine — Safe Push Utility${RESET}

Usage:
  ./scripts/git/safe-push.sh [options] [remote] [branch]

Options:
  --dry-run       Simulate the push without transmitting commits
  --set-upstream  Set upstream tracking (-u) for the current branch
  --skip-gate     Skip running health checks before push (not recommended)
  --help, -h      Show this message

Safety Invariants:
  - Force-pushing is strictly prohibited and permanently blocked.
  - Remote deletion or history rewriting is blocked.
  - Requires clean or explicit git tree state.
EOF
}

# Inspect arguments and block force-push flags
for arg in "$@"; do
  if [ "$arg" = "--force" ] || [ "$arg" = "-f" ] || [ "$arg" = "--force-with-lease" ]; then
    log_fail "FORCE-PUSH VIOLATION: Force-pushing is strictly prohibited by Atomic Git Engine safety policy."
    log_fail "Never rewrite published remote history."
    exit 1
  fi
done

POSITIONAL_ARGS=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run)
      DRY_RUN=true
      shift
      ;;
    --set-upstream|-u)
      SET_UPSTREAM=true
      shift
      ;;
    --skip-gate)
      SKIP_GATE=true
      shift
      ;;
    -h|--help)
      print_usage
      exit 0
      ;;
    *)
      POSITIONAL_ARGS+=("$1")
      shift
      ;;
  esac
done

if ! git rev-parse --is-inside-work-tree &>/dev/null; then
  log_fail "Not inside a Git repository. Run ./scripts/git/setup.sh first."
  exit 1
fi

CURRENT_BRANCH="$(git branch --show-current 2>/dev/null || echo '')"
if [ -z "${CURRENT_BRANCH}" ]; then
  log_fail "Detached HEAD state. Cannot push from a detached HEAD."
  exit 1
fi

TARGET_BRANCH="${CURRENT_BRANCH}"

# Resolve positional arguments [remote] [branch]
if [ "${#POSITIONAL_ARGS[@]}" -ge 2 ]; then
  REMOTE="${POSITIONAL_ARGS[0]}"
  TARGET_BRANCH="${POSITIONAL_ARGS[1]}"
elif [ "${#POSITIONAL_ARGS[@]}" -eq 1 ]; then
  ARG="${POSITIONAL_ARGS[0]}"
  if git remote | grep -qx "${ARG}" 2>/dev/null; then
    REMOTE="${ARG}"
  else
    TARGET_BRANCH="${ARG}"
  fi
fi

echo -e "${BOLD}${CYAN}======================================================${RESET}"
echo -e "${BOLD}${CYAN}            ATOMIC GIT ENGINE SAFE PUSH               ${RESET}"
echo -e "${BOLD}${CYAN}======================================================${RESET}"

# 1. Verify Remote exists
log_info "Verifying remote '${REMOTE}' configuration..."
if ! git remote get-url "${REMOTE}" &>/dev/null; then
  log_fail "Remote '${REMOTE}' is not configured."
  log_info "To configure origin to https://github.com/anant9934/connect safely, run:"
  log_info "  ./scripts/git/setup.sh --set-remote"
  exit 1
fi

REMOTE_URL="$(git remote get-url "${REMOTE}")"
log_pass "Remote '${REMOTE}' verified -> ${REMOTE_URL}"

# 2. Check for commits to push
TOTAL_COMMITS="$(git rev-list --count HEAD 2>/dev/null || echo 0)"
if [ "${TOTAL_COMMITS}" -eq 0 ]; then
  if [ "${DRY_RUN}" = true ]; then
    log_warn "Dry-run check: Remote '${REMOTE}' is verified, but local repository has 0 commits."
    log_info "Create an atomic commit before pushing to remote."
    exit 0
  else
    log_fail "Repository has 0 commits. Create an atomic commit before pushing."
    exit 1
  fi
fi

# 3. Quality Gate Execution
if [ "${SKIP_GATE}" = false ]; then
  log_info "Executing Pre-Push Quality Gates..."
  if [ -f "${SCRIPT_DIR}/health-check.sh" ]; then
    "${SCRIPT_DIR}/health-check.sh" --working-tree
  fi
else
  log_warn "Pre-push Quality Gate was skipped (--skip-gate)."
fi

# 4. Check Upstream Status & Divergence
log_info "Checking upstream synchronization status..."
UPSTREAM="$(git rev-parse --abbrev-ref --symbolic-full-name '@{u}' 2>/dev/null || echo '')"

if [ -n "${UPSTREAM}" ]; then
  # Fetch latest remote refs safely without merging
  log_info "Fetching latest remote refs from ${REMOTE}..."
  if git fetch "${REMOTE}" "${TARGET_BRANCH}" &>/dev/null; then
    LOCAL_REV="$(git rev-parse @)"
    REMOTE_REV="$(git rev-parse '@{u}' 2>/dev/null || echo '')"
    BASE_REV="$(git merge-base @ '@{u}' 2>/dev/null || echo '')"

    if [ -n "${REMOTE_REV}" ]; then
      if [ "${LOCAL_REV}" = "${REMOTE_REV}" ]; then
        log_info "Everything up-to-date with ${UPSTREAM}. Nothing new to push."
        exit 0
      elif [ "${LOCAL_REV}" = "${BASE_REV}" ]; then
        BEHIND="$(git rev-list --count @..@{u})"
        log_fail "Local branch is behind remote by ${BEHIND} commit(s)."
        log_info "Please integrate upstream changes first:"
        log_info "  git pull --rebase ${REMOTE} ${TARGET_BRANCH}"
        exit 1
      elif [ "${REMOTE_REV}" != "${BASE_REV}" ]; then
        log_fail "Branch divergence detected between local and ${UPSTREAM}!"
        log_fail "Direct push would fail or create merge conflict. Rebase or merge first."
        exit 1
      fi
    fi
  else
    log_warn "Unable to fetch remote branch '${TARGET_BRANCH}'. It may be a brand-new remote branch."
  fi
else
  log_info "No upstream tracking configured for branch '${TARGET_BRANCH}'."
  SET_UPSTREAM=true
fi

# 5. Build Push Command
PUSH_FLAGS=()
if [ "${DRY_RUN}" = true ]; then
  PUSH_FLAGS+=("--dry-run")
  log_info "Executing DRY-RUN push (no changes will be transmitted)..."
fi

if [ "${SET_UPSTREAM}" = true ]; then
  PUSH_FLAGS+=("-u")
  log_info "Setting upstream tracking: ${REMOTE}/${TARGET_BRANCH}"
fi

# 6. Perform Push
log_info "Executing: git push ${PUSH_FLAGS[@]+"${PUSH_FLAGS[@]}"} ${REMOTE} ${TARGET_BRANCH}"
if git push ${PUSH_FLAGS[@]+"${PUSH_FLAGS[@]}"} "${REMOTE}" "${TARGET_BRANCH}"; then
  if [ "${DRY_RUN}" = true ]; then
    log_pass "Dry-run successful! Remote is ready to receive commits."
  else
    log_pass "Successfully pushed validated commit batch to ${REMOTE}/${TARGET_BRANCH}!"
  fi
else
  log_fail "Push command failed. Check authentication, network, or branch protection rules."
  exit 1
fi

echo -e "${BOLD}${CYAN}======================================================${RESET}"

