#!/usr/bin/env bash
# ==============================================================================
# Atomic Git Engine - Setup & Initialization Script
# ==============================================================================
# Responsibilities:
# 1. Validates Git installation and environment capabilities.
# 2. Initializes the repository safely if not already a Git repository.
# 3. Detects and preserves existing branches, history, and remotes.
# 4. Sets local user credentials if missing.
# 5. Configures commit templates and pre-commit / commit-msg hooks.
# 6. Safely inspects or configures the target remote (https://github.com/anant9934/connect)
#    without ever overwriting an existing remote.
# ==============================================================================

set -euo pipefail

# --- Color formatting ---
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

log_info()    { echo -e "${CYAN}ℹ [INFO]${RESET} $1"; }
log_success() { echo -e "${GREEN}✓ [SUCCESS]${RESET} $1"; }
log_warn()    { echo -e "${YELLOW}⚠ [WARN]${RESET} $1"; }
log_error()   { echo -e "${RED}✗ [ERROR]${RESET} $1" >&2; }

# --- Script directory and workspace root ---
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKSPACE_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
cd "${WORKSPACE_ROOT}"

# --- Flags & Default Options ---
INSTALL_HOOKS=false
USER_NAME=""
USER_EMAIL=""
REMOTE_URL="https://github.com/anant9934/connect"
SET_REMOTE=false

print_usage() {
  cat <<EOF
${BOLD}Atomic Git Engine — Repository Setup Tool${RESET}

Usage:
  ./scripts/git/setup.sh [options]

Options:
  --install-hooks       Install git hooks (pre-commit, commit-msg)
  --name <name>         Set git user.name (local repository config)
  --email <email>       Set git user.email (local repository config)
  --remote-url <url>    Target remote URL (default: https://github.com/anant9934/connect)
  --set-remote          Configure origin remote if missing
  --help, -h            Show this help dialog

Examples:
  ./scripts/git/setup.sh --install-hooks
  ./scripts/git/setup.sh --name "Developer" --email "dev@example.com" --install-hooks --set-remote
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --install-hooks)
      INSTALL_HOOKS=true
      shift
      ;;
    --name)
      USER_NAME="$2"
      shift 2
      ;;
    --email)
      USER_EMAIL="$2"
      shift 2
      ;;
    --remote-url)
      REMOTE_URL="$2"
      shift 2
      ;;
    --set-remote)
      SET_REMOTE=true
      shift
      ;;
    -h|--help)
      print_usage
      exit 0
      ;;
    *)
      log_error "Unknown option: $1"
      print_usage
      exit 1
      ;;
  esac
done

echo -e "${BOLD}${CYAN}======================================================${RESET}"
echo -e "${BOLD}${CYAN}           ATOMIC GIT ENGINE SETUP & AUDIT            ${RESET}"
echo -e "${BOLD}${CYAN}======================================================${RESET}"

# 1. Detect Git installation
log_info "Inspecting Git binary..."
if ! command -v git &>/dev/null; then
  log_error "Git is not installed or not found in PATH. Please install Git first."
  exit 1
fi
GIT_VERSION="$(git --version)"
log_success "Git detected: ${GIT_VERSION}"

# 2. Check if already a git repository
log_info "Inspecting repository status in ${WORKSPACE_ROOT}..."
if git rev-parse --is-inside-work-tree &>/dev/null; then
  log_success "Existing Git repository detected. Preserving existing repository and history."
else
  log_info "No Git repository found. Initializing repository with default branch 'main'..."
  if git init -b main &>/dev/null; then
    log_success "Initialized empty Git repository with branch 'main'."
  else
    git init &>/dev/null
    git branch -M main &>/dev/null || true
    log_success "Initialized empty Git repository (branch set to 'main')."
  fi
fi

# 3. Check / Configure User Identity
CURRENT_NAME="$(git config user.name 2>/dev/null || true)"
CURRENT_EMAIL="$(git config user.email 2>/dev/null || true)"

if [ -n "${USER_NAME}" ]; then
  git config user.name "${USER_NAME}"
  log_success "Configured local user.name: ${USER_NAME}"
elif [ -z "${CURRENT_NAME}" ]; then
  log_warn "user.name is not set in Git configuration."
  # Set fallback local user if needed
  git config user.name "Atomic Agent"
  log_info "Configured fallback local user.name: Atomic Agent"
else
  log_success "Active git user.name: ${CURRENT_NAME}"
fi

if [ -n "${USER_EMAIL}" ]; then
  git config user.email "${USER_EMAIL}"
  log_success "Configured local user.email: ${USER_EMAIL}"
elif [ -z "${CURRENT_EMAIL}" ]; then
  log_warn "user.email is not set in Git configuration."
  git config user.email "agent@atomic-engine.local"
  log_info "Configured fallback local user.email: agent@atomic-engine.local"
else
  log_success "Active git user.email: ${CURRENT_EMAIL}"
fi

# 4. Configure Commit Message Template
if [ -f "${WORKSPACE_ROOT}/.gitmessage" ]; then
  git config commit.template "${WORKSPACE_ROOT}/.gitmessage"
  log_success "Configured commit.template to .gitmessage"
else
  log_warn ".gitmessage not found at workspace root; skipping commit.template config."
fi

# 5. Remote Configuration Inspection & Safe Setup
log_info "Inspecting Git remotes..."
EXISTING_ORIGIN="$(git remote get-url origin 2>/dev/null || true)"

if [ -n "${EXISTING_ORIGIN}" ]; then
  log_info "Existing 'origin' remote found: ${EXISTING_ORIGIN}"
  if [ "${EXISTING_ORIGIN}" = "${REMOTE_URL}" ]; then
    log_success "Remote 'origin' is already set to target: ${REMOTE_URL}"
  else
    log_warn "Remote 'origin' points to a different repository: ${EXISTING_ORIGIN}"
    log_warn "Safety policy: Preserving existing remote. Will NOT overwrite."
  fi
else
  log_info "No 'origin' remote is currently configured."
  if [ "${SET_REMOTE}" = true ]; then
    git remote add origin "${REMOTE_URL}"
    log_success "Configured remote origin -> ${REMOTE_URL}"
  else
    log_info "Target remote is ${REMOTE_URL}. Pass --set-remote to attach origin."
  fi
fi

# 6. Hook Installation
if [ "${INSTALL_HOOKS}" = true ]; then
  log_info "Installing Git hooks in .git/hooks/..."
  HOOKS_DIR="${WORKSPACE_ROOT}/.git/hooks"
  mkdir -p "${HOOKS_DIR}"

  # commit-msg hook
  COMMIT_MSG_HOOK="${HOOKS_DIR}/commit-msg"
  cat > "${COMMIT_MSG_HOOK}" << 'HOOK_EOF'
#!/usr/bin/env bash
# Atomic Git Engine - commit-msg hook
set -e
SCRIPT_PATH="$(git rev-parse --show-toplevel)/scripts/git/commit-check.sh"
if [ -f "${SCRIPT_PATH}" ]; then
  "${SCRIPT_PATH}" "$1"
else
  exit 0
fi
HOOK_EOF
  chmod +x "${COMMIT_MSG_HOOK}"
  log_success "Installed commit-msg hook (${COMMIT_MSG_HOOK})"

  # pre-commit hook
  PRE_COMMIT_HOOK="${HOOKS_DIR}/pre-commit"
  cat > "${PRE_COMMIT_HOOK}" << 'HOOK_EOF'
#!/usr/bin/env bash
# Atomic Git Engine - pre-commit hook
set -e
SCRIPT_PATH="$(git rev-parse --show-toplevel)/scripts/git/health-check.sh"
if [ -f "${SCRIPT_PATH}" ]; then
  "${SCRIPT_PATH}" --pre-commit
else
  exit 0
fi
HOOK_EOF
  chmod +x "${PRE_COMMIT_HOOK}"
  log_success "Installed pre-commit hook (${PRE_COMMIT_HOOK})"
else
  log_info "Git hooks not installed automatically. Run with --install-hooks to install."
fi

# 7. Summary
echo -e "${BOLD}${CYAN}------------------------------------------------------${RESET}"
echo -e "${BOLD}${GREEN}Atomic Git Engine setup successfully completed.${RESET}"
echo -e "Current Branch: $(git branch --show-current 2>/dev/null || echo 'uncommitted/main')"
echo -e "User:           $(git config user.name) <$(git config user.email)>"
echo -e "Remote:         $(git remote get-url origin 2>/dev/null || echo 'none')"
echo -e "${BOLD}${CYAN}======================================================${RESET}"

