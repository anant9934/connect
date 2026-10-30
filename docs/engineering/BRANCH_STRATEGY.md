# Branch Strategy & Lifecycle Specification

The **Atomic Git Engine** follows a modern **Trunk-Based / GitHub Flow** methodology designed for fast feedback, continuous delivery, and clean repository history.

---

## 1. Branch Hierarchy

```text
main (Production / Stable)
  ▲
  │ (Pull Request via CI Quality Gate)
  │
feature/auth-oauth2  fix/login-redirect  chore/upgrade-deps
```

- **`main`**: The canonical default branch. Must remain releasable at all times. Direct pushes are discouraged or blocked in team environments; changes arrive via verified Pull Requests.
- **Short-Lived Branches**: Branches should ideally live no longer than 1–2 days. Small, atomic commits within the branch make code reviews frictionless.

---

## 2. Branch Naming Conventions

All branch names must use lower-case letters, digits, and hyphens (`-`).

| Prefix | Usage | Example |
| :--- | :--- | :--- |
| `feature/` | New functionality or user stories | `feature/user-profiles` |
| `fix/` | Bug fixes or issue patches | `fix/session-expiry` |
| `refactor/`| Structural or architectural refactoring | `refactor/api-middleware` |
| `perf/` | Performance optimizations | `perf/db-indexing` |
| `chore/` | Tooling, dependencies, or maintenance | `chore/update-eslint` |
| `docs/` | Pure documentation additions | `docs/api-specs` |
| `hotfix/` | Critical production hotfixes | `hotfix/security-cve-patch` |

---

## 3. Branch Lifecycle Walkthrough

### Step 1: Branch Creation
Always branch from the latest state of `main`:
```bash
git checkout main
git pull --ff-only origin main
git checkout -b feature/user-profiles
```

### Step 2: Continuous Atomic Development
Make small, focused, atomic commits as you progress:
```bash
# Unit 1
git add src/models/user.ts
git commit -m "feat(user): define database model schema"

# Unit 2
git add src/services/user.ts
git commit -m "feat(user): implement profile update service"

# Unit 3
git add tests/services/user.test.ts
git commit -m "test(user): add unit tests for profile updates"
```

### Step 3: Upstream Synchronization
Keep your feature branch updated with `main` to avoid large merge conflicts:
```bash
git fetch origin main
git rebase origin/main
```

### Step 4: Verification & Safe Push
Run the pre-push Quality Gate and safe push:
```bash
./scripts/git/safe-push.sh --set-upstream origin feature/user-profiles
```

### Step 5: Merge & Clean Up
Once the Pull Request passes GitHub Actions (`quality-gate.yml` and `commit-validation.yml`), merge into `main` and delete the local feature branch:
```bash
git checkout main
git pull --ff-only origin main
git branch -d feature/user-profiles
```

