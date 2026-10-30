---
description: Safe, non-destructive recovery procedures for Git conflicts, accidental staging, detached HEAD, and rebase issues
---

# Workflow: Git Disaster Recovery & Safe Reset

Use this workflow whenever Git encounters an unexpected state, merge conflict, accidental staging, or detached HEAD.

## Recovery Procedures

### 1. Accidental Staging Recovery (Unstage Without Loss)
If files were staged unintentionally (e.g. via an accidental bulk add or sensitive file staging):
```bash
# Unstage specific file while preserving changes in working directory:
git restore --staged <file>

# Unstage all staged files safely:
git restore --staged .
```

### 2. Merge / Rebase Conflict Resolution
When Git pauses during a merge or rebase due to conflicts:
1. Inspect conflicted files:
   ```bash
   git status --short
   ```
2. For each file marked `UU` (both modified):
   - Open the file, locate conflict markers (`<<<<<<<`, `=======`, `>>>>>>>`).
   - Reconcile the code changes.
   - Delete conflict markers.
3. Validate that no markers remain:
   ```bash
   ./scripts/git/health-check.sh --working-tree
   ```
4. Stage the resolved files:
   ```bash
   git add <resolved-file>
   ```
5. Continue the rebase:
   ```bash
   git rebase --continue
   ```
   *(To abort safely without losing prior work: `git rebase --abort`)*

### 3. Detached HEAD Rescue
If commits were made in detached HEAD:
```bash
# 1. Create a rescue branch at current HEAD:
git branch rescue/detached-work

# 2. Switch back to your working branch:
git checkout main

# 3. Merge or cherry-pick the rescued commits:
git merge rescue/detached-work
```

### 4. Rescuing Stashed Changes
```bash
# View list of stashes:
git stash list

# Inspect what is inside stash@{0}:
git stash show -p stash@{0}

# Apply stash safely without dropping:
git stash apply stash@{0}

# Once confirmed working:
git stash drop stash@{0}
```

