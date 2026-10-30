---
description: Verify quality gates, upstream synchronization, and execute a safe, atomic batch push to GitHub
---

# Workflow: Safe GitHub Batch Push

Use this workflow to push completed, verified batches of atomic commits to GitHub.

## Execution Steps

### 1. Verify Working Tree State
Ensure all desired changes are committed in atomic units:
```bash
git status --short
```
If uncommitted modifications exist that belong to incomplete work, either finish the atomic commit or stash them before pushing:
```bash
git stash push -u -m "wip: incomplete work before push"
```

### 2. Run Pre-Push Quality Gate
Validate the entire codebase before synchronizing with remote:
```bash
./scripts/git/health-check.sh --working-tree
```

### 3. Review Commit Analytics & Sync Status
Check outgoing commits and remote tracking status:
```bash
./scripts/git/commit-report.sh
```

### 4. Dry-Run Push Simulation
Simulate the push to detect upstream conflicts, branch protection violations, or authentication issues:
```bash
./scripts/git/safe-push.sh --dry-run
```

### 5. Execute Safe Batch Push
Push the validated commit batch without force flags:
```bash
./scripts/git/safe-push.sh
```
*Note: If pushing a new branch for the first time, use `--set-upstream`.*

### 6. Verify Push Success
Confirm local HEAD matches remote tracking branch:
```bash
git log -1 --oneline
git status
```
Confirm the output displays `Your branch is up to date with 'origin/<branch>'`.

