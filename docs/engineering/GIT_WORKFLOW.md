# Atomic Git Workflow Specification

## 1. Core Principle: The Atomic Commit

> **ONE INDEPENDENT LOGICAL CHANGE = ONE ATOMIC COMMIT.**

An atomic commit is a self-contained, indivisible unit of work that leaves the repository in a stable, buildable, and test-passing state.

### Examples of Independent Logical Units:
- **New utility function** → `feat(utils): add email sanitizer`
- **New reusable component** → `feat(ui): create primary action button`
- **New API endpoint** → `feat(api): implement password reset endpoint`
- **API validation** → `feat(api): validate password complexity requirements`
- **Database schema migration** → `refactor(db): add index on user email`
- **Unit / integration tests** → `test(auth): add password reset unit tests`
- **Bug fix** → `fix(auth): handle expired token error gracefully`
- **Documentation improvement** → `docs(api): document password reset payload`
- **Performance optimization** → `perf(cache): memoize user session lookups`

Never artificially bundle unrelated changes into a single mega-commit. Never accumulate an entire feature into one large commit unnecessarily.

---

## 2. The 10-Step Continuous Development Lifecycle

Every coding agent or developer working on this codebase must follow this execution cycle:

```text
  ┌─────────────────────────────────────────────────────────────┐
  │ 1. UNDERSTAND: Read requirements & identify domain scope    │
  └──────────────────────────────┬──────────────────────────────┘
                                 │
  ┌──────────────────────────────▼──────────────────────────────┐
  │ 2. PLAN: Decompose work into small, atomic logical units     │
  └──────────────────────────────┬──────────────────────────────┘
                                 │
  ┌──────────────────────────────▼──────────────────────────────┐
  │ 3. IMPLEMENT: Code exactly ONE logical unit                 │
  └──────────────────────────────┬──────────────────────────────┘
                                 │
  ┌──────────────────────────────▼──────────────────────────────┐
  │ 4. TEST: Execute unit tests / quality checks                │
  └──────────────────────────────┬──────────────────────────────┘
                                 │
  ┌──────────────────────────────▼──────────────────────────────┐
  │ 5. INSPECT: Review unstaged diff (git diff)                 │
  └──────────────────────────────┬──────────────────────────────┘
                                 │
  ┌──────────────────────────────▼──────────────────────────────┐
  │ 6. SMART STAGE: Stage ONLY files for this logical unit      │
  │    (Strictly git add <path>; NEVER git add . or -A)         │
  └──────────────────────────────┬──────────────────────────────┘
                                 │
  ┌──────────────────────────────▼──────────────────────────────┐
  │ 7. VALIDATE: Review staged changes (git diff --cached)      │
  │    Run ./scripts/git/health-check.sh                        │
  └──────────────────────────────┬──────────────────────────────┘
                                 │
  ┌──────────────────────────────▼──────────────────────────────┐
  │ 8. ATOMIC COMMIT: Commit using Conventional Commit format   │
  └──────────────────────────────┬──────────────────────────────┘
                                 │
  ┌──────────────────────────────▼──────────────────────────────┐
  │ 9. VERIFY: Confirm commit hash and message (git log -1)     │
  └──────────────────────────────┬──────────────────────────────┘
                                 │
  ┌──────────────────────────────▼──────────────────────────────┐
  │ 10. REPEAT / PUSH: Next unit OR safe batch push             │
  │     Run ./scripts/git/safe-push.sh                          │
  └─────────────────────────────────────────────────────────────┘
```

---

## 3. Smart Staging Rules

1. **Explicit File Paths Only**:
   - `git add path/to/file.ts path/to/file.test.ts`
   - Never run `git add .` or `git add -A`. Bulk adding captures untracked scratch files, `.env` files, debug logs, and unrelated modifications.
2. **Preserve Unrelated Changes**:
   - If other modified files exist in the working tree, leave them unstaged.
   - If an existing file contains changes belonging to multiple units, use patch staging (`git add -p <file>`) to isolate the exact hunks.
3. **Secret & Large File Interception**:
   - The pre-commit quality gate automatically blocks `.env`, private keys (`.pem`, `.key`, `id_rsa`), and files larger than 10MB.

---

## 4. Automation Scripts Reference

| Script | Purpose | Usage |
| :--- | :--- | :--- |
| `setup.sh` | Initializes repo, checks remotes, installs hooks & templates | `./scripts/git/setup.sh [--install-hooks] [--set-remote]` |
| `commit-check.sh` | Enforces Conventional Commit format & rejects junk messages | `./scripts/git/commit-check.sh "<message>"` |
| `health-check.sh` | Runs pre-commit quality gates (secrets, conflicts, syntax, tests) | `./scripts/git/health-check.sh [--pre-commit \| --working-tree]` |
| `commit-report.sh`| Real Git commit analytics, type distribution, sync status | `./scripts/git/commit-report.sh` |
| `audit.sh` | Deep repository audit, tree analysis, commit grouping advice | `./scripts/git/audit.sh` |
| `safe-push.sh` | Safe GitHub push, zero force-push, diverged branch protection | `./scripts/git/safe-push.sh [--dry-run]` |

---

## 5. Remote Synchronization & Safe Push Protocol

- **Target Repository**: `https://github.com/anant9934/connect`
- **Zero Force-Push Policy**: `--force` and `-f` are blocked at script and workflow levels. Published history is never rewritten.
- **Push Cadence**: Push when an end-to-end task or milestone is complete, after verifying that all atomic commits in the batch pass quality gates.

