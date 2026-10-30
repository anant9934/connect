# Git Troubleshooting & Disaster Recovery Guide

This guide details safe, non-destructive recovery procedures for common Git situations encountered during development.

---

## 1. Accidental Staging of Unwanted Files

### Scenario:
You accidentally ran `git add .` or staged `.env`, secrets, or unrelated files.

### Solution:
Unstage the files without losing your local modifications:
```bash
# Unstage a specific file
git restore --staged <path-to-file>

# Or unstage everything staged while preserving all working directory changes
git restore --staged .
```

---

## 2. Push Rejected: Local Branch is Behind Remote

### Scenario:
`./scripts/git/safe-push.sh` reports that your branch is behind the remote origin.

### Solution:
Integrate upstream commits using fast-forward or rebase (never force-push):
```bash
# 1. Fetch latest remote branches
git fetch origin main

# 2. Rebase your atomic commits on top of origin
git rebase origin/main

# 3. If there are conflicts, resolve them file by file:
git status
# (edit conflicted files, remove <<<<<<< markers)
git add <resolved-file>
git rebase --continue

# 4. Once rebase succeeds, run safe push:
./scripts/git/safe-push.sh
```

---

## 3. Resolving Merge / Rebase Conflicts

### Steps:
1. Identify conflicting files:
   ```bash
   git status
   ```
2. Open each conflicted file and locate conflict markers:
   ```text
   <<<<<<< HEAD
   Current local changes
   =======
   Incoming remote changes
   >>>>>>> commit-hash
   ```
3. Edit the code to combine the correct logic, and delete all `<<<<<<<`, `=======`, and `>>>>>>>` markers.
4. Verify with the quality gate:
   ```bash
   ./scripts/git/health-check.sh --working-tree
   ```
5. Stage the resolved files and continue:
   ```bash
   git add <resolved-file>
   git rebase --continue # (or git commit if in a merge)
   ```

---

## 4. Recovering from Detached HEAD State

### Scenario:
`git status` displays `HEAD detached at <commit-hash>`. Commits made here risk being lost if you checkout another branch.

### Solution:
Save your detached HEAD work into a new branch:
```bash
# 1. Create a branch referencing your current detached HEAD commits
git branch recovery/temp-work

# 2. Switch back to your desired branch
git checkout main

# 3. Cherry-pick or merge the recovered commits
git merge recovery/temp-work
```

---

## 5. Safely Stashing Unfinished Work

### Scenario:
You need to switch tasks or branches immediately, but your working tree has uncommitted edits.

### Solution:
```bash
# Stash including untracked files with a descriptive label
git stash push -u -m "wip: authentication form styling"

# Later, list stashes to verify
git stash list

# Reapply the stash safely without dropping it immediately
git stash apply stash@{0}

# Once confirmed working, drop the stash
git stash drop stash@{0}
```

---

## 6. Correcting the Most Recent Commit (Before Push)

### Scenario:
You noticed a typo in the commit message or forgot to include a file, but you have NOT yet pushed.

### Solution:
```bash
# If adding a missing file:
git add path/to/forgotten-file.ts

# Amend the commit without rewriting published remote history:
git commit --amend -m "feat(scope): corrected atomic commit description"
```
> [!CAUTION]
> Never amend commits that have already been pushed to a shared remote repository.

---

## 7. Recovering Accidental Deletions with Git Reflog

### Scenario:
A branch was accidentally deleted, or a rebase went wrong.

### Solution:
```bash
# Inspect the reflog history
git reflog

# Find the commit hash before the mistake occurred (e.g., HEAD@{3})
# Restore to a recovery branch:
git checkout -b recovery/restored-work HEAD@{3}
```

