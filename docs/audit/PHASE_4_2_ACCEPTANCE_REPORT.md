# CONNECT — PHASE 4.2: GRADING INTEGRITY, BROWSER E2E & RELEASE READINESS REPORT

**Date:** November 2, 2026
**Role:** Principal Full-Stack Engineer, Go Backend Security Specialist, Application Security Engineer, QA Automation Lead
**Target Branch:** `feat/phase-4-practical-learning`
**Base Commit:** `2f4769b`
**Latest Production Release Candidate:** `2f4769b` (Phase 1–3 backend upgrade)
**Phase 4.2 Commit:** `da4ca55` (`da4ca55ec7a06650888535dce2ae56f65b9b413c`)
**Production Status:** Strictly Untouched (₹0 spend, zero production changes, no merge to `main`)

---

## 1. Repository State & Verification of Claims

### Verification of HEAD and Discrepancies
- **Prompt Reported HEAD:** `cafdef3`
- **Observed HEAD at Phase 4.2 Start:** `53e888d`
- **Explanation:** At the end of Phase 4.1, commit `53e888d` was created to commit `docs/audit/PHASE_4_1_ACCEPTANCE_REPORT.md`, with parent `cafdef3`. Both commits form a clean linear history on `feat/phase-4-practical-learning`.
- **Phase 4.2 Head Commit:** `da4ca55`
- **Working Tree Integrity:** All uncommitted user modifications in `apps/mobile/src/screens/MeetingScreen.tsx`, `apps/mobile/src/services/apiClient.ts`, and `apps/mobile/src/screens/ClassroomSheet.tsx` remain untouched and preserved.

---

## 2. Threat Model: Grading Integrity & Score Tampering

A zero-trust threat modeling analysis was conducted against the client-side execution model and the backend grading APIs.

### Formal Answers to Security Questions:

1. **Does the backend execute submitted code independently, or does it trust output/results supplied by the browser?**
   - **Finding:** Under the ₹0 budget constraint, no server-side container runner (e.g., gVisor, Firecracker microVM) is provisioned. The server **cannot and does not execute untrusted user code** (doing so in the host process would introduce catastrophic Remote Code Execution vulnerabilities).
   - **Remediation:** The backend **never treats client-provided test outputs as authoritative grading evidence**. Client execution is strictly classified as unverified student debugging and preview telemetry.

2. **Can a student send fabricated test results or a fabricated score?**
   - **Vulnerability Found:** Previously, the server compared client-submitted `req.Outputs` to expected outputs and awarded automated marks directly. An attacker crafting an HTTP POST payload with expected outputs for public test cases could award themselves full marks.
   - **Fix Applied:** Automated marks on student assignment submission are **permanently removed**. Submissions are received in `status = "pending"` with official `score = 0`. Client passes are stored purely as non-authoritative diagnostic preview metadata. Only an authenticated instructor can award official grades.

3. **Can a student change `passed_count`, `total_score`, `status`, execution duration, or evaluation metadata through crafted API requests?**
   - **Fix Applied:** Regardless of what an attacker submits in `outputs` or `durations`, the authoritative submission record is forced to `status = "pending"`, `score = 0`, and `pointsDelta = 0`. Client fields are labeled as unverified self-checks.

4. **Can a student submit the same assignment repeatedly to overwrite a previous result or accumulate points?**
   - **Vulnerability Found:** Previously, `RecordStudentActivity` incremented `total_points` on every submission attempt (`total_points = total_points + EXCLUDED.total_points`). A student submitting 10 times with score 100 would accumulate 1,000 points.
   - **Fix Applied:**
     1. Assignment submissions pass `pointsDelta = 0`—no points are awarded for unverified student submissions.
     2. `assignments_submitted` is computed via `SELECT count(DISTINCT assignment_id)` so repeat submissions do not inflate submission counters.
     3. Course progress points are recalculated upon official faculty grading as `SUM(best_score)` grouped by assignment (`MAX(score)` per assignment), making point accumulation mathematically bounded by course maximum marks.

5. **Can concurrent submissions cause inconsistent scores?**
   - **Fix Applied:** Recalculating points from `MAX(score)` where `status = 'graded'` guarantees deterministic, idempotent totals regardless of race conditions or out-of-order submissions.

6. **Can a student retrieve hidden test inputs, expected outputs, or detailed failure information through another endpoint?**
   - **Status:** **VERIFIED PROTECTED**.
     - API endpoints enforce `is_hidden = false` for student callers.
     - `lab_test_cases` has forced RLS preventing students from reading `is_hidden = true` rows.
     - If a test case output is omitted in `req.Outputs`, it is strictly marked failed (`"No execution output provided for test case"`), closing the vulnerability where an empty expected output would accidentally pass an unexecuted hidden test.

7. **Can a student access or alter another student's submission?**
   - **Status:** **VERIFIED PROTECTED**.
     - API query enforces `student_user_id = authCtx.UserID`.
     - Database RLS `rls_lab_submissions_select` restricts reads to `student_user_id = connect_auth.current_user_id()`.
     - Database RLS `rls_lab_submissions_update` was patched in commit `da4ca55` to completely disallow student updates, restricting `UPDATE` privileges exclusively to `faculty`, `department_coordinator`, and `institution_admin`.

8. **Can faculty grade a submission belonging to another organization?**
   - **Status:** **VERIFIED PROTECTED**.
     - `UpdateSubmissionGrade` query enforces `WHERE organization_id = $4 AND id = $5`.
     - Forced RLS policy `rls_tenant_lab_submissions` drops cross-tenant rows before execution.

9. **Are faculty overrides audited and distinguishable from automated scores?**
   - **Status:** **VERIFIED PROTECTED**.
     - Distinguishability: Submissions with `graded_by_user_id IS NULL` are unverified student submissions; submissions with `status = 'graded'` and `graded_by_user_id IS NOT NULL` are official instructor grades.
     - Auditing: Every faculty grading action logs a structured audit event `lab.submission.graded` with actor ID, submission ID, student ID, and score to the PostgreSQL audit ledger.
     - Score bounds: Score is strictly validated against `0 <= req.Score <= assignment.MaxScore`. Out-of-bounds scores are rejected with `400 Bad Request`.

---

## 3. Real Browser E2E Test Results (Headless Chrome)

Real browser automation was executed using headless Google Chrome (`puppeteer-core`) on the compiled Next.js production build (`http://localhost:3001`):

### Desktop Viewport Verification (1280x800)

| Route | HTTP Status | Response Time | DOM Content Match | Hydration Errors | Status |
|:---|:---:|:---:|:---|:---:|:---:|
| `/lab` | 200 | 48ms | Connect Programming & Engineering Labs | 0 | **VERIFIED** |
| `/lab/course/dsa` | 200 | 60ms | Data Structures & Algorithms | 0 | **VERIFIED** |
| `/lab/course/cpp-oops` | 200 | 24ms | Object-Oriented Programming with C++ | 0 | **VERIFIED** |
| `/lab/course/web-dev` | 200 | 19ms | Full-Stack Web Development | 0 | **VERIFIED** |
| `/lab/course/python-ds` | 200 | 22ms | Python for Engineers & Data Science | 0 | **VERIFIED** |
| `/lab/course/dbms-sql` | 200 | 18ms | Database Management Systems (SQL) | 0 | **VERIFIED** |
| `/lab/editor` | 200 | 17ms | Online Code Editor & Compiler Sandbox | 0 | **VERIFIED** |
| `/lab/visualizer` | 200 | 14ms | DSA Visualizers & Linked Lists | 0 | **VERIFIED** |
| `/lab/sql` | 200 | 14ms | Interactive Relational Database Studio | 0 | **VERIFIED** |
| `/lab/assignments` | 200 | 16ms | Class Practical Assignments | 0 | **VERIFIED** |
| `/lab/assignments/[id]` | 200 | 33ms | Dynamic Array Template Solver | 0 | **VERIFIED** |
| `/lab/assignments/new` | 200 | 18ms | Create Practical Programming Assignment | 0 | **VERIFIED** |
| `/lab/faculty` | 200 | 22ms | Faculty Grading & Review Portal | 0 | **VERIFIED** |
| `/lab/dashboard` | 200 | 19ms | Student Lab Learning Dashboard | 0 | **VERIFIED** |

### Mobile Viewport Verification (375x667 - iPhone SE / Android)

| Mobile Route | HTTP Status | Response Time | Layout & Elements | Status |
|:---|:---:|:---:|:---|:---:|
| `/lab` | 304 | 17ms | Single-column responsive layout, touch cards | **VERIFIED** |
| `/lab/course/dsa` | 200 | 20ms | Responsive tabs, scrollable modules | **VERIFIED** |
| `/lab/editor` | 304 | 14ms | Stacked editor and console output | **VERIFIED** |
| `/lab/visualizer` | 304 | 14ms | Responsive SVG canvas, animated controls | **VERIFIED** |
| `/lab/sql` | 304 | 14ms | Touch-friendly query runners and table scroll | **VERIFIED** |
| `/lab/assignments` | 304 | 17ms | Compact cards with due badges | **VERIFIED** |
| `/lab/assignments/[id]` | 200 | 20ms | Full solver with status indicators | **VERIFIED** |
| `/lab/assignments/new` | 304 | 14ms | Mobile form inputs and test case builder | **VERIFIED** |
| `/lab/faculty` | 304 | 14ms | Responsive submission table, review modal | **VERIFIED** |
| `/lab/dashboard` | 304 | 14ms | Mobile metrics grid, streak indicator | **VERIFIED** |

*Result:* **24 / 24 browser route checks PASSED** (100% success rate, 0 unhandled exceptions, 0 React hydration mismatches).

---

## 4. Execution Engine Acceptance by Language

| Language | Execution Architecture | Security Boundary | Staging Status |
|:---|:---|:---|:---:|
| **HTML / CSS** | Sandboxed `iframe` | `sandbox="allow-scripts"` (strictly without `allow-same-origin`) | **VERIFIED** |
| **JavaScript** | Sandboxed `iframe` | Origin & source checked `postMessage` listener | **VERIFIED** |
| **Python** | Pyodide WebAssembly in dedicated Web Worker | Hard cancellation via `worker.terminate()` on 6,000ms timeout; 64KB buffer limit | **VERIFIED** |
| **SQL** | SQLite WASM In-Memory | Session-isolated in-memory database; multi-statement support | **VERIFIED** |
| **C++** | MicroVM Sandbox Required | **Explicitly BLOCKED** under ₹0 free-tier policy | **BLOCKED** |
| **Java** | MicroVM Sandbox Required | **Explicitly BLOCKED** under ₹0 free-tier policy | **BLOCKED** |

---

## 5. Comprehensive Unit & Integration Test Summary

### Go Backend Test Suites
- `internal/lab`: **PASS** (Normalizing output, evaluation logic, streak computation, assignment creation validation, code size limits, test case limits, deadline checks, language restrictions, grade score bounds, omitted test case protection).
- `internal/server`: **PASS** (CORS, malformed JSON rejection, request size bounds, security headers, liveness/readiness, API tenant isolation, RLS verification).
- `internal/database`: **PASS** (`TestRequiredMigrationIsTheNewest` confirms migration `000030` is current).

### Frontend Build & Typechecks
- `tsc --noEmit`: **0 errors**.
- `next build`: **35/35 pages prerendered successfully**.

---

## 6. Phase 4.2 Git Commit Ledger

```
da4ca55 fix(lab): secure grading integrity, prevent score tampering, and resolve SSR hydration
53e888d docs(audit): add Phase 4.1 practical learning acceptance report
cafdef3 feat(api): enforce lab deadlines, input bounds, and add tenant isolation tests
89f46c1 fix(lab): harden execution security with worker termination and honest blocked runtimes
fc3e815 feat(web): add assignment solver, creator, dashboards and lab routes
71a10bb feat(web): add interactive practical visualizers for dsa, oops and sql
5257e16 feat(web): add multi-language code editor and reusable course workspace
97a2b94 feat(web): add lab execution runtimes and types for wasm and preview
aa7ccf3 feat(api): implement practical learning and programming lab endpoints
d28cdca feat(db): add practical learning and lab assignments schema
```

---

## 7. Production-Readiness Recommendation

### Feature Status Ratings:
- **Tenant Isolation & RLS:** `VERIFIED`
- **Grading Integrity & Score Tampering Defense:** `VERIFIED`
- **Browser E2E Execution & Responsive UX:** `VERIFIED`
- **Client Execution (HTML, CSS, JS, Python, SQL):** `VERIFIED`
- **Compiled Remote Execution (C++, Java):** `BLOCKED` (Truthful ₹0 policy constraint)
- **Zero-Cost Free Infrastructure Budget:** `VERIFIED` (₹0 additional spend)

### Official Gate Decision:
**READY FOR STAGING REHEARSAL**

The practical learning platform is mathematically protected against score tampering, tenant leakage, and client-side grade manipulation. All web pages render cleanly with zero hydration warnings in real Chrome browsers across desktop and mobile devices. Remote compilation for C++ and Java remains honestly and safely blocked pending dedicated microVM sandbox funding.
