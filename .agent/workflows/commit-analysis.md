---
description: Analyze working tree changes, identify atomic units, and generate split commit recommendations
---

# Workflow: Commit Analysis & Atomic Decomposition

Use this workflow when working tree changes have accumulated and need to be decomposed into clean, independent atomic commits.

## Execution Steps

### 1. Run Working Tree Audit
Run the deep audit tool to inspect file modifications and review auto-generated atomic groupings:
```bash
./scripts/git/audit.sh
```

### 2. Inspect File-by-File Diffs
Examine changes grouped by subsystem:
```bash
# Check status with file type indicators:
git status --porcelain

# Review diff for specific files:
git diff path/to/target/file
```

### 3. Decompose Changes into Atomic Units
Apply the atomic separation criteria:
- **Unit A: Foundation / Utilities / Types**: Code that introduces reusable abstractions.
  - Suggested: `feat(core): ...` or `refactor(types): ...`
- **Unit B: Core Logic / Endpoints**: Functional implementation.
  - Suggested: `feat(api): ...` or `feat(auth): ...`
- **Unit C: Tests**: Unit or integration tests verifying the behavior.
  - Suggested: `test(auth): ...`
- **Unit D: Documentation / Config**: Specs, markdown files, configuration files.
  - Suggested: `docs(api): ...` or `chore(config): ...`

### 4. Stage and Commit Unit by Unit
Follow `.agent/workflows/atomic-commit.md` sequentially for each identified unit:
1. Stage unit files explicitly: `git add <files>`
2. Verify staged diff: `git diff --cached`
3. Validate: `./scripts/git/health-check.sh --pre-commit`
4. Commit: `git commit -m "type(scope): description"`
5. Verify: `git log -1 --stat`
6. Repeat for remaining files until working tree is clean.

