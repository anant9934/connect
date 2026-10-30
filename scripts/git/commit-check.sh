#!/usr/bin/env bash
# ==============================================================================
# Atomic Git Engine - Commit Message Validator
# ==============================================================================
# Validates commit messages according to the Conventional Commits specification
# and Atomic Git Engine quality gates.
#
# Supported Types:
#   feat, fix, refactor, perf, test, docs, style, chore, build, ci, security, revert
#
# Format:
#   <type>(<scope>): <description>
#   <type>!: <breaking change description>
#   <type>(<scope>)!: <breaking change description>
#
# Rejection Criteria:
#   - Empty or comment-only messages
#   - Invalid or unrecognized commit types
#   - Missing colon/space separator
#   - Generic/meaningless messages ("update", "work", "final", "test123", "wip", etc.)
#   - Subject lines exceeding configured max length
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

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_FILE="${SCRIPT_DIR}/../../config/git-engine.json"

if [ $# -lt 1 ]; then
  echo -e "${RED}Error: No commit message or commit message file provided.${RESET}" >&2
  echo -e "Usage: $0 \"<commit-message>\" OR $0 <path-to-commit-msg-file>" >&2
  exit 1
fi

INPUT="$1"

# Extract raw message: check if input is an existing file or a raw message string
if [ -f "${INPUT}" ]; then
  RAW_MSG="$(cat "${INPUT}")"
else
  RAW_MSG="${INPUT}"
fi

# Run validation via python3 for reliable regex and config handling
python3 - <<PY_EOF
import sys
import re
import json
import os

raw_msg = """${RAW_MSG}"""
config_path = "${CONFIG_FILE}"

# Allowed types
DEFAULT_TYPES = [
    "feat", "fix", "refactor", "perf", "test", "docs",
    "style", "chore", "build", "ci", "security", "revert"
]

DEFAULT_PROHIBITED = [
    "update", "updates", "changes", "work", "wip", "final",
    "test123", "misc", "fixed", "stuff", "patch", "asdf"
]

MAX_HEADER_LENGTH = 100
MIN_SUBJECT_LENGTH = 3

if os.path.exists(config_path):
    try:
        with open(config_path, "r", encoding="utf-8") as f:
            cfg = json.load(f)
            convention = cfg.get("convention", {})
            if "types" in convention:
                DEFAULT_TYPES = [t["type"] if isinstance(t, dict) else t for t in convention["types"]]
            if "prohibitedWords" in convention:
                DEFAULT_PROHIBITED = [p.strip("^$").lower() for p in convention["prohibitedWords"]]
            MAX_HEADER_LENGTH = convention.get("maxHeaderLength", 100)
            MIN_SUBJECT_LENGTH = convention.get("minSubjectLength", 3)
    except Exception as e:
        pass

# Strip comments starting with '#'
lines = [l for l in raw_msg.splitlines() if not l.strip().startswith("#")]
non_empty = [l for l in lines if l.strip()]

if not non_empty:
    print("\033[0;31m✗ [REJECTED]\033[0m Commit message is empty or contains only comments.", file=sys.stderr)
    sys.exit(1)

header = non_empty[0].strip()

# Check length
if len(header) > MAX_HEADER_LENGTH:
    print(f"\033[0;31m✗ [REJECTED]\033[0m Header length ({len(header)}) exceeds maximum limit of {MAX_HEADER_LENGTH} characters.", file=sys.stderr)
    print(f"Header: {header}", file=sys.stderr)
    sys.exit(1)

# Regex pattern for conventional commits:
# type(scope)!: description OR type!: description OR type(scope): description OR type: description
types_regex = "|".join(DEFAULT_TYPES)
pattern = rf"^({types_regex})(\([a-zA-Z0-9_\-\.\/]+\))?(!)?:\s+(.+)$"

match = re.match(pattern, header)
if not match:
    print(f"\033[0;31m✗ [REJECTED]\033[0m Commit message does not match Conventional Commits format.", file=sys.stderr)
    print(f"\nReceived Header: \"{header}\"", file=sys.stderr)
    print("\nExpected format: <type>(<scope>): <description>  OR  <type>: <description>", file=sys.stderr)
    print(f"Allowed types: {', '.join(DEFAULT_TYPES)}", file=sys.stderr)
    print("\nValid examples:", file=sys.stderr)
    print("  feat(auth): implement email verification", file=sys.stderr)
    print("  fix(dashboard): resolve duplicate dashboard rendering", file=sys.stderr)
    print("  refactor(database): extract connection utilities", file=sys.stderr)
    print("  test(api): add endpoint validation tests", file=sys.stderr)
    print("  docs(architecture): document service architecture", file=sys.stderr)
    print("  perf(search): optimize database query execution", file=sys.stderr)
    sys.exit(1)

commit_type = match.group(1)
commit_scope = match.group(2)
is_breaking = match.group(3)
description = match.group(4).strip()

if len(description) < MIN_SUBJECT_LENGTH:
    print(f"\033[0;31m✗ [REJECTED]\033[0m Description \"{description}\" is too short (minimum {MIN_SUBJECT_LENGTH} characters).", file=sys.stderr)
    sys.exit(1)

# Check prohibited generic phrases
desc_lower = description.lower()
clean_words = re.findall(r'\b[a-zA-Z0-9_]+\b', desc_lower)

for word in clean_words:
    if word in DEFAULT_PROHIBITED and len(clean_words) <= 2:
        print(f"\033[0;31m✗ [REJECTED]\033[0m Generic/meaningless commit message detected: \"{description}\".", file=sys.stderr)
        print("Please provide a descriptive explanation of what changed and why.", file=sys.stderr)
        sys.exit(1)

# Check if whole description is just generic
if desc_lower in DEFAULT_PROHIBITED:
    print(f"\033[0;31m✗ [REJECTED]\033[0m Generic commit message: \"{description}\" is not allowed.", file=sys.stderr)
    sys.exit(1)

# Check trailing period
if description.endswith("."):
    print(f"\033[0;33m⚠ [WARN]\033[0m Conventional commit subjects typically should not end with a period.", file=sys.stderr)

print(f"\033[0;32m✓ [VALID]\033[0m Conventional commit accepted: {header}")
sys.exit(0)
PY_EOF

