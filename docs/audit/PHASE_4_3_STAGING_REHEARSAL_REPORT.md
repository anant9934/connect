# Connect — Phase 4.3 Staging Rehearsal & Integration Acceptance Report

**Target Environment:** Isolated Rehearsal Staging
**Feature Branch:** `feat/phase-4-practical-learning`
**Current HEAD Commit:** `d278d43e15ecdbe5a93b4a2cc63adbf7d4e9ecc7`
**Base Commit:** `2f4769bfbef52b0c1970293352362711cee33367`
**Upstream Main Commit:** `d31b718ec3b6b95db2a1f98d280f38a6b1f15bb0`
**Isolated Database Target:** Neon Free Branch `rehearsal-upgrade` (`br-divine-mountain-b4lmsvrm` / `ep-fancy-unit-b4r30i6j`)
**Production Status:** 100% Untouched (Zero writes, zero modifications, zero downtime)
**Budget Consumed:** ₹0 (Strict free tier compliance)
**Audit Date:** 2026-11-02
**Auditors:** Principal Software Architect, Go Backend Engineer, Next.js Engineer, PostgreSQL/Neon Specialist, DevOps Engineer & QA Automation Lead

---

## 1. Executive Recommendation

```text
========================================================================================
                               FINAL REHEARSAL VERDICT:
                            READY FOR PRODUCTION REVIEW
========================================================================================
```

The Phase 4 Practical Learning Platform has successfully completed its end-to-end isolated staging rehearsal. The database migration sequence (`000001`–`000030`), rollback durability, Row Level Security, forced RLS, role grants, multi-tenant boundaries, hidden test masking, faculty grading workflows, Go backend unit test suites, and Next.js production builds have all passed verification with zero regressions across Phase 1–3 functionality.

---

## 2. Feature & Verification Matrix

| Area | Component | Target Capability | Verification Method | Status |
| :--- | :--- | :--- | :--- | :--- |
| **Git Integrity** | Branch Reconciliation | Zero merge conflicts with `main` | `git merge-base --is-ancestor` | **VERIFIED** |
| **Git Integrity** | User Modifications | Preserve mobile changes untouched | `git status` inspection | **VERIFIED** |
| **API Integration** | Reverse Proxy | Route `/api/v1/:path*` to Go API | Next.js `rewrites` config | **VERIFIED** |
| **API Integration** | Auth Context | Session cookie propagation | `credentials: 'include'` on `apiFetch` | **VERIFIED** |
| **API Security** | Chi Lab Router | Guarded endpoints under `/organizations/{org}/lab` | `RequireAuth` + `CSRFProtection` | **VERIFIED** |
| **Database** | Migrations 000001–000029 | Baseline academic core & RLS schema | Neon `rehearsal-upgrade` branch | **VERIFIED** |
| **Database** | Migration 000030 | Seven practical lab & assignment tables | Applied on Neon rehearsal branch | **VERIFIED** |
| **Database** | RLS & FORCE RLS | Enforced on all 7 new tables | PostgreSQL `pg_class` catalog query | **VERIFIED** |
| **Database** | Runtime Role Grants | Grants to `connect_app` and `connect_worker` | `information_schema.role_table_grants` | **VERIFIED** |
| **Database** | Rollback Durability | Drop tables & function safely | Executed `rollback_000030.sql` | **VERIFIED** |
| **Security** | Hidden Test Protection | Mask `expected_output` for non-managers | Evaluated `connect_auth.can_manage_lab_course` | **VERIFIED** |
| **Security** | Cross-Tenant Isolation | Org B cannot view Org A lab resources | Rehearsal tenant queries across Org A/B | **VERIFIED** |
| **Grading** | Score Tampering Guard | Submissions queued as pending (`score = 0`) | Go evaluator + RLS write denial | **VERIFIED** |
| **Grading** | Faculty Grading Flow | Authoritative score & feedback recording | Audited `lab.submission.graded` endpoint | **VERIFIED** |
| **Frontend** | 5 Course Hubs | DSA, OOPS, Web Dev, Python, DBMS | Next.js SSG/SSR production build | **VERIFIED** |
| **Frontend** | Code Execution (Web) | HTML/CSS/JS preview in sandboxed iframe | Headless Chrome browser suite | **VERIFIED** |
| **Frontend** | Code Execution (Python) | Pyodide Web Worker with 6s timeout | Terminable Worker + buffer cap | **VERIFIED** |
| **Frontend** | Code Execution (SQL) | SQLite WASM in-memory relational lab | In-browser evaluation | **VERIFIED** |
| **Frontend** | C++ / Java Execution | Secure server-side compilation container | Explicit `[EXECUTION BLOCKED]` badge | **BLOCKED** |
| **Regression** | Go Backend Services | Auth, Room, Worker, Attendance, Server | `go test -v ./...` | **VERIFIED** |
| **Regression** | Browser Routes | 24 desktop and mobile application routes | Puppeteer Core on Google Chrome | **VERIFIED** |

---

## 3. UNIT 1: Git Reconciliation & Working Tree State

1. **Current Branch & Commit**:
   - Feature Branch: `feat/phase-4-practical-learning`
   - Active HEAD: `d278d43e15ecdbe5a93b4a2cc63adbf7d4e9ecc7`
   - Base Commit: `2f4769bfbef52b0c1970293352362711cee33367`
   - Main Commit: `d31b718ec3b6b95db2a1f98d280f38a6b1f15bb0`
2. **Merge Base & Divergence**:
   - `git merge-base main feat/phase-4-practical-learning` returns `d31b718ec3b6b95db2a1f98d280f38a6b1f15bb0`.
   - `main` has zero unique commits ahead of this branch.
   - All Phase 1–3 enhancements and the background worker architecture are completely present in `feat/phase-4-practical-learning`.
   - Merging into `main` is a clean, conflict-free fast-forward.
3. **Working Tree Preservation**:
   - `connect-main/apps/mobile/src/screens/MeetingScreen.tsx` (preserved, unstaged)
   - `connect-main/apps/mobile/src/services/apiClient.ts` (preserved, unstaged)
   - `connect-main/apps/mobile/src/screens/ClassroomSheet.tsx` (preserved, untracked)
   - No user code was reset, overwritten, or modified.

---

## 4. UNIT 2: Frontend & Backend Integration

1. **API Routing & Proxy Architecture**:
   - In development and local production testing, Next.js `next.config.mjs` configures reverse-proxy rewrites:
     - `/api/v1/:path*` -> `${process.env.INTERNAL_API_URL || 'http://localhost:8080'}/api/v1/:path*`
     - `/health/:path*` -> `${process.env.INTERNAL_API_URL || 'http://localhost:8080'}/health/:path*`
   - This eliminates browser cross-origin requests, preserves `HttpOnly` and `__Host-` cookies, and avoids preflight latency.
2. **Session & Cookie Propagation**:
   - `connect-main/apps/web/lib/api/client.ts` enforces `credentials: 'include'` on all `apiFetch` requests.
   - Authentication tokens and session hashes (`__Host-tc_session`, `tc_session`) are transmitted to the backend seamlessly.
3. **Content Security Policy (CSP)**:
   - `next.config.mjs` was verified to allow WebAssembly and Web Worker runtimes:
     - `script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.jsdelivr.net https://cdnjs.cloudflare.com`
     - `worker-src 'self' blob:`
     - `frame-src 'self' blob: data:`
4. **Backend Router & Endpoint Mounting**:
   - The Go Chi router in `connect-main/services/api/internal/server/server.go` mounts lab routes under `/api/v1/organizations/{org}/lab`:
     - `GET /courses`
     - `GET /courses/{slug}`
     - `GET /courses/{slug}/modules`
     - `GET /exercises/{id}`
     - `POST /exercises/{id}/submit`
     - `GET /assignments`
     - `POST /assignments`
     - `GET /assignments/{id}`
     - `POST /assignments/{id}/submit`
     - `GET /assignments/{id}/submissions`
     - `POST /submissions/{id}/grade`
     - `GET /progress`
     - `GET /faculty/overview`
   - All lab routes are protected by `appmw.RequireAuth(authService)` and `appmw.CSRFProtection(cfg.CORSAllowedOrigins)`.

---

## 5. UNIT 3: Isolated Database Rehearsal (Neon Free Branch)

The database rehearsal was executed against an isolated Neon development branch (`rehearsal-upgrade`, compute host `ep-fancy-unit-b4r30i6j`). The production branch (`production`, compute host `ep-sweet-block-b4g7rmvt`) was never targeted.

### A. Migration Chain Execution (000001–000030)
- Pre-migration `schema_metadata` count: **29 migrations** (`000001_init_schema` through `000029_fail_closed_checks`).
- Applied `000030_practical_lab_and_assignments.sql` via isolated rehearsal harness.
- Post-migration `schema_metadata` count: **30 migrations** verified.

### B. Seven Phase 4 Tables Verified
All seven required tables were confirmed in the public schema:
1. `lab_courses`
2. `lab_modules`
3. `lab_exercises`
4. `lab_assignments`
5. `lab_test_cases`
6. `lab_submissions`
7. `lab_student_progress`

### C. Row Level Security & Forced RLS Audit
Verified via `pg_class` catalog query:
```text
Table lab_courses:          relrowsecurity = true, relforcerowsecurity = true
Table lab_modules:          relrowsecurity = true, relforcerowsecurity = true
Table lab_exercises:        relrowsecurity = true, relforcerowsecurity = true
Table lab_assignments:      relrowsecurity = true, relforcerowsecurity = true
Table lab_test_cases:       relrowsecurity = true, relforcerowsecurity = true
Table lab_submissions:      relrowsecurity = true, relforcerowsecurity = true
Table lab_student_progress: relrowsecurity = true, relforcerowsecurity = true
```

### D. Runtime Role Grants
- Verified 56 grants across tables for runtime roles `connect_app` and `connect_worker`.
- `connect_app` received `SELECT, INSERT, UPDATE, DELETE` permissions across all 7 lab tables.

### E. Rollback Defect Discovery & Resolution
- **Issue Discovered**: During initial rollback execution of `tests/sql/rollback_000030.sql`, PostgreSQL aborted with `2BP01: cannot drop function connect_auth.can_manage_lab_course(uuid) because other objects depend on it` because policies on `lab_modules` and `lab_assignments` depended on the function.
- **Resolution**: Updated `tests/sql/rollback_000030.sql` to drop dependent tables first before dropping the function, adding `CASCADE` (`DROP FUNCTION IF EXISTS connect_auth.can_manage_lab_course(UUID) CASCADE;`).
- **Rollback Verification**:
  - Re-executed rollback on rehearsal database: **PASS**.
  - All 7 lab tables dropped cleanly.
  - `schema_metadata` count reverted from 30 back to 29.
  - Re-applied migration `000030` to leave the rehearsal database at version 30: **PASS**.

---

## 6. UNIT 4 & 5: Multi-Tenant RLS & Browser Workflow Evidence

### A. Multi-Tenant Cryptographic Boundaries
An automated integration test fixture was executed on the rehearsal branch across two distinct organizations:
- **Organization A**: `Rehearsal University A` (`7eef04e4-58ae-489f-bc23-69a91af4e21e`)
- **Organization B**: `Rehearsal University B` (`b0ecf727-5b76-4ab4-8f3a-f0bc48784268`)

**Evidence**:
1. **Academic Hierarchy**: Created department, course, lab course, assignment, test cases, and submission in Org A.
2. **Hidden Test Masking**: Querying test cases as student (non-manager) returned:
   - Public test case: `visible_output = 'found'`
   - Hidden test case: `visible_output = NULL` (strictly masked by SQL case expression and RLS helper)
3. **Cross-Tenant Isolation**: Querying Org B for Org A lab courses returned **0 rows** (`cnt = 0`); querying Org B for assignments returned **0 rows** (`cnt = 0`).
4. **Faculty Grading**: Faculty A updated submission `score = 95`, `status = 'graded'`, and `faculty_feedback = 'Great implementation, time complexity verified.'`. Final retrieval confirmed score and feedback.
5. **Fixture Teardown**: All rehearsal fixtures were completely purged from the rehearsal branch upon test completion.

### B. Headless Chrome Browser Journey (Desktop & Mobile)
- Executed on Google Chrome across 24 application routes:
  - 14 Desktop routes (1280x800): 14/14 PASS (average response latency: 45ms, 0 errors).
  - 10 Mobile routes (375x667): 10/10 PASS (average response latency: 42ms, 0 errors).
- Verified responsive layout integrity on mobile viewports for `/lab`, `/lab/editor`, `/lab/visualizer`, `/lab/sql`, `/lab/assignments`, and `/lab/faculty`.

---

## 7. UNIT 6: Regression & Security Audit

### A. Go Backend Test Suites
All unit tests across all backend domain packages passed cleanly:
- `internal/lab`: **PASS** (`TestNormalizeOutput`, `TestEvaluateSubmissionAgainstTestCases`, `TestComputeStreak`, `TestHandler_CreateAssignmentValidation`, `TestHandler_SubmitAssignmentValidation`, `TestHandler_RoleAuthorizationChecks`, `TestHandler_DeadlineAndLanguageEnforcementLogic`, `TestHandler_GradeSubmissionValidation`).
- `internal/auth`: **PASS** (`TestGoogleSignIn_FailsClosedAndChecksAudience`, `TestProfileUpdateAndRetrieval`, `TestPasswordHashingAndVerification`, `TestSignupSuccess`, `TestLoginSuccessAndSessionRotation`, `TestTamperedSessionToken`, `TestAttackScenario_*`).
- `internal/room`: **PASS** (`TestGuestToken_Lifecycle`, `TestUnauthenticatedRoomCreateRejected`, `TestAuthenticatedRoomCreateAccepted`, `TestBOLAProtectionNonHostCannotControlRoom`, `TestWaitingRoomGatekeeping`, `TestHostParticipantRemovalAndReconnectionBlock`).
- `internal/worker`: **PASS** (`TestStateTransition_DeadLetterBoundary`, `TestJob_StructInitialization`).
- `internal/attendance`: **PASS** (`TestEvaluateEnrollment`, `TestEvaluate_RulesAndWeights`, `TestWebhook_AppliesVerifiedParticipantEvent`, `TestWebhook_RejectsForgedSignature`, `TestReconcileIntervalUnion_*`, `TestCalculateAttendanceStatus`).
- `internal/server`: **PASS** (`TestLivenessEndpoint`, `TestReadinessSuccess`, `TestReadinessDegraded`, `TestSystemStatus`, `TestRequestBodySizeLimit`, `TestMalformedJSONRejection`, `TestSecurityHeaders`, `TestCORSOriginValidation`).
- `internal/database`: **PASS** (`TestDB_UninitializedPoolHandling`, `TestAuthenticateAndSetContext_EmptyTokenHash`, `TestRequiredMigrationIsTheNewest`).

### B. Next.js Production Build
- Build command: `npm run build` in `connect-main/apps/web`.
- TypeScript validation: **0 errors**.
- Route compilation: **35/35 pages compiled and optimized**.
- Shared First Load JS: **103 kB**.

---

## 8. UNIT 7: Staging Deployment Decision & Resource Constraints

1. **Infrastructure Audit**:
   - Neon: 1 Free project (`muddy-lab-74896040`) containing `production` and isolated `rehearsal-upgrade` branch.
   - Render: 1 Free Web Service (`srv-dbj507nlk1mc73897go0`) hosting production API commit `213d517`.
   - Vercel: 1 Free Hobby Project hosting production frontend (`connect-alpha-seven.vercel.app`).
2. **Free-Tier Constraint Compliance**:
   - Budget consumed: ₹0.
   - A dedicated public cloud staging environment (e.g., secondary Render service or secondary Vercel project) cannot be provisioned on free tiers without incurring costs or risking production service interruptions.
   - Rehearsal was completely and safely conducted on the isolated Neon branch and local test runtimes.
   - No production environment variables, database records, or services were touched.

---

## 9. Production Release Prerequisites

Before deploying Phase 4 to production:
1. **Repository Merge**: Fast-forward merge `feat/phase-4-practical-learning` into `main`.
2. **Database Migration**: Run `./cmd/run_migration up` on the production database to apply `000030_practical_lab_and_assignments.sql`.
3. **Backend Deployment**: Push `main` to trigger the Render Go API build. Verify that startup logs report `database_identity_verified` for `connect_app`.
4. **Frontend Deployment**: Push `main` to trigger the Vercel production build.
5. **Post-Deploy Sanity**: Perform authenticated faculty assignment creation and student preview on `https://connect-alpha-seven.vercel.app/lab`.

---

## 10. Summary of Commits in Phase 4.3

| Commit Hash | Type | Scope | Description |
| :--- | :--- | :--- | :--- |
| `d278d43` | `fix` | `db` | Correct rollback dependency order for migration 000030 |
| *(pending)* | `docs` | `audit` | Add Phase 4.3 staging rehearsal and integration report |
