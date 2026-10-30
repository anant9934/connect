#!/usr/bin/env bash
# ==============================================================================
# Atomic Git Engine - Commit Analytics & Health Reporting Utility
# ==============================================================================
# Computes real Git analytics strictly from repository history:
#   - Total commit count
#   - Commits today, this week (7d), this month (30d)
#   - Commit distribution across Conventional Commit types
#   - Contributor breakdown
#   - Latest commit details
#   - Working tree cleanliness (staged, modified, untracked)
#   - Remote synchronization status (ahead, behind, in-sync)
# ==============================================================================

set -euo pipefail

# ANSI color codes
if [ -t 1 ]; then
  BOLD="\033[1m"
  GREEN="\033[0;32m"
  YELLOW="\033[0;33m"
  RED="\033[0;31m"
  CYAN="\033[0;36m"
  BLUE="\033[0;34m"
  RESET="\033[0m"
else
  BOLD=""
  GREEN=""
  YELLOW=""
  RED=""
  CYAN=""
  BLUE=""
  RESET=""
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKSPACE_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
cd "${WORKSPACE_ROOT}"

# Check if inside git repository
if ! git rev-parse --is-inside-work-tree &>/dev/null; then
  echo -e "${RED}Error: Not inside a Git repository.${RESET}" >&2
  exit 1
fi

CURRENT_BRANCH="$(git branch --show-current 2>/dev/null || echo 'HEAD (detached)')"
if [ -z "${CURRENT_BRANCH}" ]; then
  CURRENT_BRANCH="main (uncommitted)"
fi

# Check if repository has any commits
TOTAL_COMMITS="$(git rev-list --count HEAD 2>/dev/null || echo 0)"

echo -e "${BOLD}${CYAN}======================================================${RESET}"
echo -e "${BOLD}${CYAN}               ATOMIC GIT ENGINE REPORT               ${RESET}"
echo -e "${BOLD}${CYAN}======================================================${RESET}"

if [ "${TOTAL_COMMITS}" -eq 0 ]; then
  echo -e "Total commits: 0"
  echo -e "Today's commits: 0"
  echo -e "Weekly commits: 0"
  echo -e "Monthly commits: 0"
  echo ""
  echo -e "${YELLOW}No commits in repository history yet.${RESET}"
  echo ""
  
  # Working tree status
  STAGED_COUNT="$(git diff --cached --name-only 2>/dev/null | wc -l | tr -d ' ')"
  MODIFIED_COUNT="$(git diff --name-only 2>/dev/null | wc -l | tr -d ' ')"
  UNTRACKED_COUNT="$(git ls-files --others --exclude-standard 2>/dev/null | wc -l | tr -d ' ')"
  
  if [ "${STAGED_COUNT}" -eq 0 ] && [ "${MODIFIED_COUNT}" -eq 0 ] && [ "${UNTRACKED_COUNT}" -eq 0 ]; then
    echo -e "Working tree: ${GREEN}CLEAN${RESET}"
  else
    echo -e "Working tree: ${YELLOW}DIRTY${RESET} (Staged: ${STAGED_COUNT}, Modified: ${MODIFIED_COUNT}, Untracked: ${UNTRACKED_COUNT})"
  fi
  
  echo -e "Branch: ${BLUE}${CURRENT_BRANCH}${RESET}"
  
  # Remote sync
  REMOTE_URL="$(git remote get-url origin 2>/dev/null || echo 'NONE')"
  if [ "${REMOTE_URL}" = "NONE" ]; then
    echo -e "Remote: NO_REMOTE"
  else
    echo -e "Remote: CONFIGURED (${REMOTE_URL})"
  fi
  echo -e "${BOLD}${CYAN}======================================================${RESET}"
  exit 0
fi

# 1. Date-based metrics
TODAY_COMMITS="$(git rev-list --count --since="midnight" HEAD 2>/dev/null || echo 0)"
WEEKLY_COMMITS="$(git rev-list --count --since="7 days ago" HEAD 2>/dev/null || echo 0)"
MONTHLY_COMMITS="$(git rev-list --count --since="30 days ago" HEAD 2>/dev/null || echo 0)"

echo -e "Total commits:   ${BOLD}${TOTAL_COMMITS}${RESET}"
echo -e "Today's commits: ${BOLD}${TODAY_COMMITS}${RESET}"
echo -e "Weekly commits:  ${BOLD}${WEEKLY_COMMITS}${RESET}"
echo -e "Monthly commits: ${BOLD}${MONTHLY_COMMITS}${RESET}"
echo ""

# 2. Conventional Commit Type Distribution
echo -e "${BOLD}Commit Distribution by Type:${RESET}"
python3 - << 'PY_EOF'
import subprocess
import re

types = [
    "feat", "fix", "refactor", "perf", "test",
    "docs", "style", "chore", "build", "ci",
    "security", "revert"
]
counts = {t: 0 for t in types}
counts["other"] = 0

try:
    log_output = subprocess.check_output(
        ["git", "log", "--pretty=format:%s"],
        stderr=subprocess.DEVNULL
    ).decode("utf-8", errors="replace")
    
    for subject in log_output.splitlines():
        subject = subject.strip()
        if not subject:
            continue
        m = re.match(r'^([a-zA-Z0-9_\-]+)(\(.*\))?!?:\s*(.+)$', subject)
        if m and m.group(1).lower() in counts:
            counts[m.group(1).lower()] += 1
        else:
            counts["other"] += 1
            
    for t in types:
        if counts[t] > 0:
            print(f"  {t:10}: {counts[t]}")
    if counts["other"] > 0:
        print(f"  {'other':10}: {counts['other']}")
except Exception as e:
    print("  Unable to compute distribution")
PY_EOF
echo ""

# 3. Latest Commit Details
LATEST_HASH="$(git log -1 --pretty=format:"%h" 2>/dev/null || echo 'N/A')"
LATEST_SUBJECT="$(git log -1 --pretty=format:"%s" 2>/dev/null || echo 'N/A')"
LATEST_AUTHOR="$(git log -1 --pretty=format:"%an" 2>/dev/null || echo 'N/A')"
LATEST_RELATIVE="$(git log -1 --pretty=format:"%cr" 2>/dev/null || echo 'N/A')"

echo -e "Latest commit:   ${GREEN}${LATEST_HASH}${RESET} - \"${LATEST_SUBJECT}\" (${LATEST_AUTHOR}, ${LATEST_RELATIVE})"

# 4. Working Tree Status
STAGED_COUNT="$(git diff --cached --name-only 2>/dev/null | wc -l | tr -d ' ')"
MODIFIED_COUNT="$(git diff --name-only 2>/dev/null | wc -l | tr -d ' ')"
UNTRACKED_COUNT="$(git ls-files --others --exclude-standard 2>/dev/null | wc -l | tr -d ' ')"

if [ "${STAGED_COUNT}" -eq 0 ] && [ "${MODIFIED_COUNT}" -eq 0 ] && [ "${UNTRACKED_COUNT}" -eq 0 ]; then
  echo -e "Working tree:    ${GREEN}CLEAN${RESET}"
else
  echo -e "Working tree:    ${YELLOW}DIRTY${RESET} (Staged: ${STAGED_COUNT}, Modified: ${MODIFIED_COUNT}, Untracked: ${UNTRACKED_COUNT})"
fi

# 5. Branch
echo -e "Branch:          ${BLUE}${CURRENT_BRANCH}${RESET}"

# 6. Remote Synchronization Status
UPSTREAM="$(git rev-parse --abbrev-ref --symbolic-full-name '@{u}' 2>/dev/null || echo '')"
if [ -z "${UPSTREAM}" ]; then
  REMOTE_URL="$(git remote get-url origin 2>/dev/null || echo '')"
  if [ -z "${REMOTE_URL}" ]; then
    echo -e "Remote:          ${YELLOW}NO_REMOTE${RESET}"
  else
    echo -e "Remote:          ${YELLOW}NO_UPSTREAM_TRACKING${RESET} (origin configured: ${REMOTE_URL})"
  fi
else
  LOCAL_REV="$(git rev-parse @ 2>/dev/null)"
  REMOTE_REV="$(git rev-parse '@{u}' 2>/dev/null)"
  BASE_REV="$(git merge-base @ '@{u}' 2>/dev/null || echo '')"

  if [ "${LOCAL_REV}" = "${REMOTE_REV}" ]; then
    echo -e "Remote:          ${GREEN}SYNCHRONIZED${RESET} (synced with ${UPSTREAM})"
  elif [ "${LOCAL_REV}" = "${BASE_REV}" ]; then
    BEHIND_COUNT="$(git rev-list --count @..@{u} 2>/dev/null || echo 0)"
    echo -e "Remote:          ${RED}BEHIND${RESET} (behind by ${BEHIND_COUNT} commits)"
  elif [ "${REMOTE_REV}" = "${BASE_REV}" ]; then
    AHEAD_COUNT="$(git rev-list --count @{u}..@ 2>/dev/null || echo 0)"
    echo -e "Remote:          ${YELLOW}AHEAD${RESET} (ahead by ${AHEAD_COUNT} commits)"
  else
    echo -e "Remote:          ${RED}DIVERGED${RESET} (local and remote have diverged)"
  fi
fi

# 7. Contributors
CONTRIBUTORS="$(git shortlog -sn --all 2>/dev/null | head -n 5 || true)"
if [ -n "${CONTRIBUTORS}" ]; then
  echo ""
  echo -e "${BOLD}Top Contributors:${RESET}"
  echo "${CONTRIBUTORS}" | while read -r line; do
    echo "  ${line}"
  done
fi

echo -e "${BOLD}${CYAN}======================================================${RESET}"

