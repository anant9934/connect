---
description: Execute a verified, quality-gated atomic Git commit for an independent logical unit
---

# Workflow: Atomic Commit Execution

Use this workflow whenever you have completed a single independent logical unit of work.

## Execution Steps

### 1. Inspect Working Tree
Check current workspace status without modifying anything:
```bash
git status --short
```

### 2. Identify the Atomic Unit
Confirm that the pending changes represent exactly ONE logical unit (e.g., one function, one component, one bug fix, or one test addition). If multiple distinct units are modified, select only the files belonging to the first unit.

### 3. Run Relevant Tests
Run unit tests or linting relevant to the changed files:
- If Node.js: `npm test` (or relevant test runner)
- If Python: `pytest <test_file>` or `python3 -m unittest`
Ensure all tests pass before proceeding.

### 4. Review Unstaged Diff
Inspect the exact diff of the target files:
```bash
git diff path/to/file1 path/to/file2
```

### 5. Smart Stage (Explicit Files Only)
Stage ONLY the files belonging to this logical unit. NEVER use `git add .`:
```bash
git add path/to/file1 path/to/file2
```

### 6. Run Pre-Commit Quality Gate
Execute the automated health check against staged files:
```bash
./scripts/git/health-check.sh --pre-commit
```
If this fails, STOP immediately. Address all reported errors (e.g. remove secrets or fix formatting) and re-stage before proceeding.

### 7. Validate Commit Message
Check your intended commit message against Conventional Commits:
```bash
./scripts/git/commit-check.sh "type(scope): description"
```
Ensure the message explains what changed and why in imperative mood.

### 8. Create Atomic Commit
Commit with the validated message:
```bash
git commit -m "type(scope): description"
```

### 9. Verify Commit Hash & Stat
Inspect the newly recorded commit:
```bash
git log -1 --stat
```
Note the commit hash in your progress record.

### 10. Repeat for Next Unit
If additional unstaged files remain in `git status`, proceed to the next atomic unit.

