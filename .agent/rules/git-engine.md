# ATOMIC GIT ENGINE — AGENT OPERATIONAL RULES

This document defines immutable, non-negotiable rules for any coding agent operating within this workspace.

---

## 1. The Atomic Commit Mandate

1. **Continuous Incremental Commits**:
   - You must NOT accumulate an entire feature, module, or multi-file refactoring into one massive end-of-session commit.
   - Commit as soon as a single independent logical change is complete, tested, and validated.
2. **Definition of an Atomic Unit**:
   - One utility function = one commit.
   - One reusable component = one commit.
   - One API endpoint or route = one commit.
   - One schema migration = one commit.
   - Accompanying unit tests = dedicated commit (or coupled commit if indivisible).
   - One bug fix = one commit.
   - One documentation update = one commit.
3. **Commit Hash Verification**:
   - Immediately following every `git commit`, you must execute `git log -1 --stat` to verify the commit hash and staged contents before proceeding to the next unit.

---

## 2. Conventional Commit Enforcement

All commit messages MUST adhere to Conventional Commits:

```text
<type>(<scope>): <description in present imperative>
```

- **Allowed Types**: `feat`, `fix`, `refactor`, `perf`, `test`, `docs`, `style`, `chore`, `build`, `ci`, `security`, `revert`.
- **Allowed Scopes**: e.g., `auth`, `api`, `ui`, `db`, `config`, `deps`, `infra`, `test`, `docs`, `git`.
- **Prohibited Messages**: Never use generic phrases such as `update`, `changes`, `work`, `wip`, `final`, `test123`, `fixed`, `stuff`, `misc`.
- **Imperative Present Tense**: Use `add`, not `added` or `adds`; `fix`, not `fixed`.
- **No Trailing Period**: Do not end the subject with `.`.

Validate before committing:
```bash
./scripts/git/commit-check.sh "<message>"
```

---

## 3. Smart Staging Policy

- **PROHIBITED**: `git add .`, `git add -A`, or wildcard adds that swallow the working tree.
- **MANDATORY**: Explicit path staging:
  ```bash
  git add src/components/Button.tsx src/components/Button.test.tsx
  ```
- **Preserve Unrelated Work**: If other files are modified in the working tree, do not stage them until their respective logical unit is addressed.
- **Review Cached Diff**: Always verify `git diff --cached` before committing.

---

## 4. Pre-Commit Quality Gates

Before finalizing any commit, execute:
```bash
./scripts/git/health-check.sh --pre-commit
```
The commit MUST BE ABORTED if:
- Merge conflict markers (`<<<<<<<`) are found.
- Sensitive files (`.env`, `.pem`, `.key`, `credentials.json`) are staged.
- Hardcoded secrets, AWS keys, or API tokens are detected in the diff.
- Project test suites fail.

---

## 5. Safe GitHub Remote Synchronization

- **Target Remote**: `https://github.com/anant9934/connect`
- **Zero Force-Push Policy**: `--force` and `-f` are strictly forbidden. Never rewrite published history.
- **Push Execution**:
  ```bash
  ./scripts/git/safe-push.sh
  ```
- If remote is ahead, pull with rebase (`git pull --rebase origin <branch>`), resolve conflicts atomically, and push safely.

