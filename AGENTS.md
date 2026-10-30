# AGENTS.md — Workspace Git Automation & Development Protocols

> **TARGET AUDIENCE**: AI Coding Agents (including Google Antigravity) & Autonomous Engineering Subagents.  
> **PURPOSE**: Enforce continuous, quality-gated, atomic Git commits throughout development sessions.

---

## 1. Master Agent Mandate

You are operating under the **Atomic Git Engine** architecture. Every coding session must follow continuous atomic commit discipline:

1. **Never accumulate an entire feature into one mega-commit.**
2. **One independent logical change = one atomic commit.**
3. **Commit continuously as you build.**
4. **Never run `git add .` or `git add -A`.** Always stage explicit file paths (`git add <file>`).
5. **Always validate quality gates before committing.**
6. **Always verify the commit hash immediately after committing.**
7. **Never force-push (`--force`, `-f`). Never rewrite published history.**
8. **Preserve unrelated user modifications.**

---

## 2. The Atomic Execution Cycle

For every feature or modification requested by the user, follow this exact lifecycle:

```text
UNDERSTAND
    ↓
PLAN (Break into small, independent logical units)
    ↓
IMPLEMENT SMALL LOGICAL UNIT (Code unit 1)
    ↓
TEST (Run relevant unit test / build / syntax checks)
    ↓
REVIEW DIFF (git diff <files>)
    ↓
VALIDATE (./scripts/git/health-check.sh --pre-commit)
    ↓
ATOMIC COMMIT (git commit -m "type(scope): description")
    ↓
VERIFY (git log -1 --stat)
    ↓
NEXT IMPLEMENTATION UNIT (Repeat for units 2, 3...)
    ↓
PUSH VALIDATED BATCH (./scripts/git/safe-push.sh)
    ↓
GENERATE REPORT (./scripts/git/commit-report.sh)
```

---

## 3. Conventional Commit Standard

All commit messages must strictly match Conventional Commits:

```text
<type>(<scope>): <subject in present imperative>
```

### Supported Types:
- `feat`: New feature or capability
- `fix`: Bug fix
- `refactor`: Structural code changes without behavior change
- `perf`: Performance improvements
- `test`: Adding or correcting tests
- `docs`: Documentation-only changes
- `style`: Whitespace, formatting, semicolons
- `chore`: Tooling, configs, dependency bumps
- `build`: Build system or packaging
- `ci`: CI/CD pipelines & GitHub Actions
- `security`: Security patches, CVE fixes
- `revert`: Reverting a previous commit

### Prohibited Commit Messages:
Messages consisting of generic words (`update`, `changes`, `work`, `wip`, `final`, `test123`, `fixed`, `misc`, `stuff`) will be rejected by the validation engine.

Always pre-validate before committing:
```bash
./scripts/git/commit-check.sh "<intended-commit-message>"
```

---

## 4. Smart Staging & Quality Gates

### Staging Rules:
- ✅ **DO**: `git add src/utils/format.ts src/utils/format.test.ts`
- ❌ **DON'T**: `git add .` or `git add -A`
- If unrelated modified files exist in the working tree, leave them untouched and unstaged.

### Pre-Commit Health Check:
Before committing, execute:
```bash
./scripts/git/health-check.sh --pre-commit
```
This automatically verifies:
1. Absence of merge conflict markers (`<<<<<<<`, `=======`, `>>>>>>>`).
2. Absence of sensitive credential files (`.env`, `.pem`, `.key`, `id_rsa`, `credentials.json`).
3. Absence of hardcoded private keys or tokens in the staged diff.
4. Clean Git whitespace (no trailing whitespace or indentation corruption).
5. No oversized binary blobs (> 10MB).
6. Passing project tests (auto-detected for Node.js, Python, Go, Rust).

---

## 5. Workflows Quick Reference

All standardized workflows reside in `.agent/workflows/`:

| Workflow File | Purpose | Invocation / Action |
| :--- | :--- | :--- |
| [atomic-commit.md](file://.agent/workflows/atomic-commit.md) | Standard atomic commit lifecycle | Run when an independent unit is complete |
| [git-audit.md](file://.agent/workflows/git-audit.md) | Deep repository health & audit | `./scripts/git/audit.sh` |
| [git-recovery.md](file://.agent/workflows/git-recovery.md) | Disaster recovery (unstage, stash, conflicts) | Follow recovery steps when errors occur |
| [release-push.md](file://.agent/workflows/release-push.md) | Safe GitHub batch push | `./scripts/git/safe-push.sh` |
| [commit-analysis.md](file://.agent/workflows/commit-analysis.md) | Decompose accumulated changes | Review diff & group into atomic units |

---

## 6. Automation Scripts Reference

All scripts are located in `scripts/git/`:

```bash
# 1. Initialize repo, hooks, and commit template
./scripts/git/setup.sh --install-hooks

# 2. Check commit message format
./scripts/git/commit-check.sh "feat(core): implement user authentication"

# 3. Run pre-commit or working-tree health check
./scripts/git/health-check.sh --pre-commit
./scripts/git/health-check.sh --working-tree

# 4. Generate real commit analytics report
./scripts/git/commit-report.sh

# 5. Perform repository audit and grouping recommendations
./scripts/git/audit.sh

# 6. Push validated commits safely to GitHub
./scripts/git/safe-push.sh
```

---

## 7. Remote Configuration Policy

- **Target Repository**: `https://github.com/anant9934/connect`
- **Zero Force-Push Guarantee**: `--force` and `-f` flags are permanently blocked. Never force-push or rewrite remote history.
- Push only after all atomic units in the batch have passed local tests and quality gates.

