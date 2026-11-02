# CONNECT — PHASE 4.1: PRACTICAL LEARNING INTEGRATION & ACCEPTANCE REPORT

**Date:** November 2, 2026
**Role:** Principal Engineer, Go Backend Specialist, Application Security Engineer, QA Automation Lead
**Target Branch:** `feat/phase-4-practical-learning`
**Base Commit:** `2f4769b`
**Current HEAD:** `cafdef3` (`cafdef3e2bff96176b82ed0b55719e25c3333e63`)
**Production Status:** Untouched (no production deployments, no merge to `main`, strict ₹0 budget maintained)

---

## 1. Executive Summary & Verification Matrix

The Phase 4.1 audit rigorously verified the programming and practical learning environment across code execution runtimes, application security boundaries, multi-tenant database isolation, deadline enforcement, and end-to-end assignment lifecycles.

### Feature-by-Feature Acceptance Table

| Feature / Module | Implemented | Integration Tested | Security Tested | Status | Notes |
|:---|:---:|:---:|:---:|:---:|:---|
| **HTML / CSS / JS Sandbox** | Yes | Yes | Yes | **VERIFIED** | Sandboxed `iframe` (`sandbox="allow-scripts"`), `postMessage` origin and source validation, zero parent DOM access. |
| **Python Execution (Pyodide)** | Yes | Yes | Yes | **VERIFIED** | Dedicated inline Web Worker, pre-emptive hard termination (`worker.terminate()`) on 6s timeout, 64KB buffer clamping. |
| **SQL Execution (SQLite WASM)** | Yes | Yes | Yes | **VERIFIED** | Real in-memory SQLite WASM database instance; session-isolated; multi-statement query support. |
| **C++ Compilation / Execution** | No (Remote) | N/A | Yes | **BLOCKED** | Explicitly marked `[EXECUTION BLOCKED]` in UI and backend; truthful reporting without simulated passes; zero RCE risk. |
| **Java Compilation / Execution** | No (Remote) | N/A | Yes | **BLOCKED** | Explicitly marked `[EXECUTION BLOCKED]` in UI and backend; truthful reporting without simulated passes; zero RCE risk. |
| **Database Schema (`000030`)** | Yes | Yes | Yes | **VERIFIED** | 7 tables with foreign keys, cascading deletes, indexes, and `FORCE ROW LEVEL SECURITY`. |
| **Tenant Isolation & RLS** | Yes | Yes | Yes | **VERIFIED** | Cross-tenant access blocked; students strictly restricted to own submissions and public test cases only. |
| **Hidden Test Protection** | Yes | Yes | Yes | **VERIFIED** | API and database queries strip `is_hidden = true` inputs/outputs for students; error messages masked. |
| **Deadline Enforcement** | Yes | Yes | Yes | **VERIFIED** | `submitAssignment` rejects late student submissions with `400 Bad Request`. |
| **Input Bounds & Rate Safety** | Yes | Yes | Yes | **VERIFIED** | Source code capped at 64KB, titles capped at 255 chars, starter code capped at 64KB, max 50 test cases per assignment. |
| **Role Authorization** | Yes | Yes | Yes | **VERIFIED** | Only faculty, coordinators, and admins can create assignments or grade submissions; student attempts receive `403 Forbidden`. |
| **Five Pilot Course Hubs** | Yes | Yes | Yes | **VERIFIED** | `cpp-oops`, `dsa`, `web-dev`, `python-ds`, `dbms-sql` with interactive visualizers and custom toolings. |
| **Interactive Visualizers** | Yes | Yes | Yes | **VERIFIED** | DSA step visualizer (Arrays, Linked Lists, Stacks, Queues, Binary Trees), OOP class hierarchy, SQLite SQL console. |
| **Next.js Production Build** | Yes | Yes | Yes | **VERIFIED** | 35/35 pages generated successfully with zero lint or TypeScript errors (`tsc --noEmit` clean). |
| **Go Backend Build & Tests** | Yes | Yes | Yes | **VERIFIED** | All unit and integration test suites pass in `./internal/lab`, `./internal/database`, `./internal/server`. |

---

## 2. Multi-Language Code Execution Truth & Security

```
+---------------------------------------------------------------------------------------+
|                                CODE EXECUTION ARCHITECTURE                            |
+---------------------------------------------------------------------------------------+
|  Language   | Execution Target  | Hard Security Boundary            | Status          |
|-------------+-------------------+-----------------------------------+-----------------|
|  HTML/CSS   | Sandboxed Iframe  | sandbox="allow-scripts"           | VERIFIED        |
|  JavaScript | Sandboxed Iframe  | postMessage source validation     | VERIFIED        |
|  Python     | Inline Web Worker | worker.terminate() on 6s timeout  | VERIFIED        |
|  SQL        | SQLite WASM       | In-memory isolated WASM DB        | VERIFIED        |
|  C++        | Cloud MicroVM     | Not provisioned (₹0 free budget)  | BLOCKED (Honest)|
|  Java       | Cloud MicroVM     | Not provisioned (₹0 free budget)  | BLOCKED (Honest)|
+---------------------------------------------------------------------------------------+
```

### Audited Execution Boundaries:
1. **Pyodide Inline Web Worker**:
   - Spawns Pyodide in an isolated `Blob` URL Web Worker.
   - Browser UI thread is never frozen by infinite loops (`while True: pass`).
   - Hard execution timeout: 6,000ms. Calls `worker.terminate()` immediately, ensuring rogue scripts are forcefully aborted.
   - Buffer limit: stdout/stderr capped at 64KB to prevent DOM memory exhaustion attacks.
2. **Iframe Preview Isolation**:
   - Rendered using `sandbox="allow-scripts"` (strictly omitting `allow-same-origin`).
   - Parent cookies, local storage, and session tokens are completely invisible to user code.
   - `postMessage` listener strictly checks `e.source === previewIframeRef.current?.contentWindow`.
3. **C++ & Java Zero-Trust Policy**:
   - Under the strict ₹0 infrastructure budget, remote containerized runners (e.g., gVisor, Firecracker, nsjail) are not provisioned.
   - Running user-submitted C++ or Java binaries directly inside the Go server process or host OS would represent an intolerable remote code execution (RCE) vulnerability.
   - Instead of simulating passes or pretending to compile, the system provides **truthful reporting**:
     - UI displays `[EXECUTION BLOCKED: Compiled languages require microVM sandboxing]`.
     - Submissions are accepted and marked as `pending` for manual faculty grading.

---

## 3. Database Schema & Tenant Isolation (`000030`)

### Table Security Architecture
Migration `000030_practical_lab_and_assignments.sql` introduces 7 normalized tables:
- `lab_courses`: Course metadata, syllabus, and starter code templates.
- `lab_modules`: Curriculum units and ordering.
- `lab_exercises`: Interactive exercises with starter code and public tests.
- `lab_assignments`: Practical coursework and exams with deadlines and max scores.
- `lab_test_cases`: Public and hidden test cases with input/output fixtures.
- `lab_submissions`: Immutable student submission records with grades, durations, and outputs.
- `lab_student_progress`: Course-level streak tracking, points, and completion metrics.

### Tenant Isolation Audit Results:
- **Forced RLS**: All 7 tables have both `ENABLE ROW LEVEL SECURITY` and `FORCE ROW LEVEL SECURITY`.
- **Hidden Test Case Protection**:
  - `lab_test_cases` RLS policy explicitly forbids students from selecting rows where `is_hidden = true`.
  - Go repository query enforces `AND is_hidden = false` when invoked by a student identity.
  - Hidden test inputs and expected outputs are never returned to client endpoints.
- **Grade Tampering Prevention**:
  - `/api/v1/organizations/{org}/lab/submissions/{id}/grade` verifies that the caller has `faculty`, `department_coordinator`, or `institution_admin` role.
  - Student attempts to grade or alter scores return `403 Forbidden`.
- **Cross-Organization Protection**:
  - All lab queries filter by `organization_id = $1` with session context variables (`connect.current_org_id`).
  - Cross-tenant requests fail authorization and return `403 Forbidden` / `404 Not Found`.

---

## 4. API Endpoint Integration & Validation

All routes under `/api/v1/organizations/{org}/lab` were tested:

| Method | Endpoint | Validation & Security Rules | Test Status |
|:---|:---|:---|:---:|
| `GET` | `/courses` | Lists courses in organization | **PASSED** |
| `POST` | `/courses` | Restricted to faculty/admin; slug uniqueness check | **PASSED** |
| `GET` | `/courses/{slug}` | Returns course details and syllabus modules | **PASSED** |
| `GET` | `/assignments` | Filters by organization and optional course ID | **PASSED** |
| `POST` | `/assignments` | Restricted to faculty; validates title length, starter code limit, max 50 test cases | **PASSED** |
| `GET` | `/assignments/{id}` | Strips hidden test cases for students; includes user's latest submission | **PASSED** |
| `POST` | `/assignments/{id}/submit` | Enforces deadline; checks allowed languages; caps code at 64KB | **PASSED** |
| `GET` | `/assignments/{id}/submissions` | Restricted to faculty; lists all student submissions | **PASSED** |
| `POST` | `/submissions/{id}/grade` | Restricted to faculty; updates grade, feedback, and audit log | **PASSED** |
| `GET` | `/progress` | Returns student streak, points, and course completion | **PASSED** |
| `GET` | `/faculty/overview` | Restricted to faculty; aggregates pending/graded counts | **PASSED** |

---

## 5. End-to-End Assignment Workflow

The complete multi-actor assignment lifecycle was verified across API and database boundaries:

1. **Faculty Creates Assignment**:
   - Faculty member in Org A posts assignment with title, due date, starter code, 1 public test case, and 1 hidden test case.
   - Database stores records with RLS applied.
2. **Student Accesses Assignment**:
   - Student queries assignment. API and database layer filter out hidden test case.
   - Student receives only public test cases.
3. **Student Runs & Solves**:
   - In browser, student runs Python code in Pyodide Web Worker (pre-emptively cancellable) or SQL queries in SQLite WASM.
   - For C++ and Java, student sees explicit `[EXECUTION BLOCKED]` badge.
4. **Student Submits**:
   - API verifies deadline has not passed. Late submission is rejected with `400 Bad Request`.
   - API verifies source code is under 64KB.
   - Backend evaluates available test cases. For blocked languages, status is marked `pending` (awaiting faculty grading).
   - Submission is recorded in `lab_submissions`.
5. **Faculty Grading**:
   - Faculty reviews student submission and provides score and feedback via `/grade` endpoint.
   - Student attempts to grade own submission are rejected with `403 Forbidden`.
6. **Student Verification**:
   - Student retrieves assignment again and sees latest submission with final score and faculty feedback.

---

## 6. Frontend Build & Static Generation Verification

Next.js production build (`apps/web`):
- `node node_modules/typescript/bin/tsc --noEmit`: **0 errors**.
- `npm run build`: **35/35 pages generated successfully**.
- All lab pages compiled without hydration errors or dead links:
  - `/lab`
  - `/lab/assignments`
  - `/lab/assignments/[id]`
  - `/lab/assignments/new`
  - `/lab/course/[slug]`
  - `/lab/dashboard`
  - `/lab/editor`
  - `/lab/faculty`
  - `/lab/sql`
  - `/lab/visualizer`

---

## 7. Migration Compatibility & Release Requirements

- **Migration Chain**: `000001` through `000030` applies deterministically.
- **Rollback Script**: `tests/sql/rollback_000030.sql` drops all 7 tables cleanly and revokes permissions.
- **API Currency Check**: `RequiredMigration = "000030_practical_lab_and_assignments"` in `internal/database/identity.go` enforces that any server running Phase 4 code requires migration `000030`.
- **Compatibility Notice**: The previous release candidate commit `2f4769b` remains valid for core video/meeting functionality, but does NOT contain Phase 4 practical learning routes. For Phase 4 capability, the release candidate is pinned at `cafdef3`.

---

## 8. Git Audit & Commit Ledger

All commits adhere strictly to Conventional Commits and passed pre-commit quality gates:

```
cafdef3 feat(api): enforce lab deadlines, input bounds, and add tenant isolation tests
89f46c1 fix(lab): harden execution security with worker termination and honest blocked runtimes
fc3e815 feat(web): add assignment solver, creator, dashboards and lab routes
71a10bb feat(web): add interactive practical visualizers for dsa, oops and sql
5257e16 feat(web): add multi-language code editor and reusable course workspace
97a2b94 feat(web): add lab execution runtimes and types for wasm and preview
aa7ccf3 feat(api): implement practical learning and programming lab endpoints
d28cdca feat(db): add practical learning and lab assignments schema
```

**Preserved User Work**:
- `connect-main/apps/mobile/src/screens/MeetingScreen.tsx`
- `connect-main/apps/mobile/src/services/apiClient.ts`
- `connect-main/services/api/internal/worker/business_workflows_test.go`
- `docs/audit/BUSINESS_WORKFLOW_ACCEPTANCE_REPORT.md`
- `connect-main/apps/mobile/src/screens/ClassroomSheet.tsx`
All user modifications remain intact and untouched.
