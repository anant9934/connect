# Conventional Commit Specification

The **Atomic Git Engine** enforces the Conventional Commits 1.0.0 specification with strict anti-junk validation rules.

---

## 1. Commit Structure

```text
<type>(<scope>): <subject>

[optional body: explain WHAT and WHY, not HOW]

[optional footer(s): issue references, breaking changes]
```

### Breaking Changes:
Add `!` immediately before the colon, or add a `BREAKING CHANGE:` footer:
- `feat(auth)!: replace cookie sessions with bearer JWT tokens`
- Or:
  ```text
  feat(api): deprecate v1 user endpoint

  BREAKING CHANGE: The /v1/user endpoint has been removed. Use /v2/users.
  ```

---

## 2. Supported Commit Types

| Type | Intent | Example |
| :--- | :--- | :--- |
| `feat` | A new feature or capability | `feat(auth): add OAuth2 Google login flow` |
| `fix` | A bug fix or defect correction | `fix(cart): prevent double charging on retry` |
| `refactor` | Code restructuring without behavior changes | `refactor(db): extract user repository methods` |
| `perf` | Code change improving runtime efficiency | `perf(search): cache Elasticsearch query results` |
| `test` | Adding missing tests or refactoring test suites | `test(api): add contract tests for checkout API` |
| `docs` | Documentation-only updates | `docs(readme): add local development setup guide` |
| `style` | Formatting, missing semi-colons, whitespace | `style(ui): format tailwind class ordering` |
| `chore` | Maintenance tasks, dependencies, non-src code | `chore(deps): update react to v18.3` |
| `build` | Build system, packaging, compiler settings | `build(vite): optimize chunk splitting config` |
| `ci` | CI/CD pipeline scripts and workflow definitions | `ci(actions): add parallel matrix for test runs` |
| `security` | Security fixes, audit vulnerability mitigations | `security(deps): patch lodash prototype pollution` |
| `revert` | Reverting a previous commit | `revert: revert "feat(ui): add modal animation"` |

---

## 3. Recommended Scopes

Scopes categorize the subsystem affected:
- `auth`: Authentication and authorization
- `api`: HTTP / GraphQL endpoints, routing, controllers
- `ui`: Frontend components, views, layouts, styling
- `db`: Database schemas, queries, migrations, ORM models
- `config`: Environment configurations, config files
- `deps`: External dependencies and package manifests
- `infra`: Infrastructure, Docker, Terraform, deployment manifests
- `test`: Testing harnesses, mocks, fixtures
- `docs`: Documentation files
- `security`: Security scanners, encryption, sanitization
- `git`: Git automation scripts, hooks, workflow definitions

---

## 4. Subject Line Quality Rules

1. **Imperative Mood**: Use imperative present tense verbs ("add", "fix", "extract", "optimize"), never past tense ("added", "fixed") or present continuous ("adding", "fixing").
2. **Length Limit**: Maximum 100 characters for the subject line.
3. **No Trailing Period**: Do not end the subject line with a period `.`.
4. **Descriptive & Atomic**: Describe the precise logical increment achieved.

---

## 5. Good vs Bad Commit Examples

| Bad Commit (Rejected by Engine) | Reason for Rejection | Good Atomic Commit |
| :--- | :--- | :--- |
| `update` | Prohibited generic junk message | `refactor(auth): simplify password hash verification` |
| `fixed bug` | Meaningless; no type, scope, or detail | `fix(session): handle redis timeout without crash` |
| `wip` | Prohibited work-in-progress placeholder | `feat(billing): create stripe webhook listener` |
| `feat: test123` | Prohibited dummy test string | `feat(health): add kubernetes liveness probe` |
| `Add new stuff to dashboard` | Missing conventional type/scope format | `feat(dashboard): display active project metrics` |
| `fix(api): fix.` | Trailing period & meaningless word | `fix(api): parse nullable birthday fields` |
| `feat(core): a` | Description under minimum length (3 chars) | `feat(core): add UUID generator helper` |

