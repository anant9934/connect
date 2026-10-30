---
description: Perform comprehensive repository audit, health checks, and commit analytics
---

# Workflow: Git Repository Audit

Use this workflow to assess repository cleanliness, branch hygiene, security posture, and commit analytics.

## Execution Steps

### 1. Run Repository Auditor
Execute the deep audit script to inspect branches, working tree, stashes, and potential security leaks:
```bash
./scripts/git/audit.sh
```

### 2. Run Quality Gate Check
Run the pre-commit health check across the full working tree:
```bash
./scripts/git/health-check.sh --working-tree
```

### 3. Generate Commit Analytics Report
Inspect commit history statistics, conventional commit distribution, and remote sync status:
```bash
./scripts/git/commit-report.sh
```

### 4. Review Audit Findings
- **Cleanliness**: Ensure no untracked scratch files or unignored secrets exist.
- **Branch State**: Confirm you are on an active branch, not a detached HEAD.
- **Commit History**: Verify that recent commits follow Conventional Commits and represent atomic units.

