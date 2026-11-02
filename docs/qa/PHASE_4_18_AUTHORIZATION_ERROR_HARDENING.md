# CONNECT PHASE 4.18: AUTHORIZATION ERROR HANDLING & SECURITY HARDENING REPORT

**Author:** Principal Security Engineer & Senior Go Backend Engineer
**Date:** 2026-11-03
**Status:** COMPLETE & VERIFIED
**Baseline Git Commit:** `3e4c26ceb9f61ebff77480a1511f11e62ff81356`
**Target Repository:** `https://github.com/anant9934/connect`
**Production URLs (Untouched):**
- Frontend: `https://connect-alpha-seven.vercel.app`
- API Backend: `https://connect-a2fi.onrender.com`

---

## 1. Executive Summary & Final Decision

### Final Decision:
**A. BUG FIX VERIFIED — READY FOR HUMAN RELEASE APPROVAL.**

During Phase 4.17 security testing, defect `BUG-LAB-500` was flagged when unauthorized cross-tenant requests to `/api/v1/organizations/{org}/lab/courses` returned HTTP 500 and leaked internal PostgreSQL authorization details (including `SQLSTATE 42501`, internal user UUIDs, and foreign organization UUIDs).

In Phase 4.18, we conducted an exhaustive investigation, designed and implemented a centralized, fail-closed error sanitizer `handleLabError` across all 13 lab HTTP handlers in `connect-main/services/api/internal/lab/handler.go`, audited all other service packages for similar leaks, implemented an automated 7-part regression test suite in `internal/lab/handler_test.go`, and verified native Android build toolchain compatibility.

**Key Achievements:**
1. **BUG-LAB-500 Fixed:** Unauthorized cross-tenant and invalid session requests now cleanly return HTTP 403 Forbidden or HTTP 400/401/404 without leaking SQLSTATE, internal UUIDs, table schemas, or database stack traces.
2. **Centralized Hardening:** All 13 HTTP handlers in `services/api/internal/lab/` now route database errors through `handleLabError`.
3. **Audit Completed:** Verified that all other API packages (`institution`, `room`, `auth`, `notes`, `files`, `avatars`, `meetings`) already sanitize or encapsulate database errors with generic client messages.
4. **Comprehensive Regression Coverage:** 7 automated test suites added covering active member access, foreign tenant rejection, query execution prevention, zero information leakage, genuine 500 preservation, role boundaries, and hidden-test masking. 100% of tests pass.
5. **Native Android Toolchain Resolved:** Diagnosed that Android Studio's bundled OpenJDK 25 (`25.0.3`) causes React Native Gradle plugin failure (`> 25.0.3`). Discovered that using system OpenJDK 21 (`21.0.11`) resolves toolchain compatibility and successfully builds `assembleDebug` in 39 seconds across 801 tasks with 0 errors.
6. **Zero Production Impact:** Production infrastructure (Render, Vercel, Neon, LiveKit) remained 100% untouched. No production migrations or data modifications were executed. All user mobile workspace modifications were preserved.

---

## 2. BUG-LAB-500 Root Cause Analysis

### 2.1 Failure Mechanism
1. **Call Chain:**
   ```text
   HTTP Request (Cross-Tenant / Alien Org ID)
       ↓
   lab.Handler.inOrg(r, fn)
       ↓
   database.WithAuthContext(ctx, pool, tokenHash, &orgStr, fn)
       ↓
   database.AuthenticateAndSetContext(ctx, tx, tokenHash, &orgStr)
       ↓
   PostgreSQL: connect_auth.authenticate_session(p_token_hash, p_requested_org_id)
   ```
2. **Database Security Enforcement (Correct & Fail-Closed):**
   In PostgreSQL migration `000008_auth_context_and_rls.sql`, `connect_auth.authenticate_session` verifies whether the authenticated user has an active membership in the target organization:
   ```sql
   IF (v_role IS NULL OR v_mem_status != 'active') AND NOT v_is_super THEN
       RAISE EXCEPTION 'Authorization Failed: User % has no active membership in Organization %',
           v_user_id, p_requested_org_id USING ERRCODE = 'insufficient_privilege';
   END IF;
   ```
   PostgreSQL raises `SQLSTATE 42501` (`insufficient_privilege`), causing the transaction to immediately roll back. No foreign data was ever read or exposed.
3. **HTTP Mapping Defect:**
   `database.AuthenticateAndSetContext` returned `fmt.Errorf("failed to authenticate database session context: %w", err)`.
   In `services/api/internal/lab/handler.go`, line 102 and throughout the file, handlers caught the error and blindly passed `err.Error()` to `writeError`:
   ```go
   // VULNERABLE CODE (PRE-FIX):
   if err != nil {
       writeError(w, http.StatusInternalServerError, err.Error())
   }
   ```
   This produced the response:
   ```json
   HTTP/1.1 500 Internal Server Error
   Content-Type: application/json

   {
     "error": "failed to authenticate database session context: ERROR: Authorization Failed: User 4220b22f-d890-410a-8d18-baec52dc7796 has no active membership in Organization 11111111-2222-3333-4444-555555555555 (SQLSTATE 42501)"
   }
   ```
4. **Defect Summary:**
   - **Incorrect HTTP Status Code:** Returned HTTP 500 (Internal Server Error) instead of HTTP 403 (Forbidden) for an expected authorization failure.
   - **Internal Information Disclosure:** Echoed raw SQL errors, PostgreSQL function context, internal user UUIDs, and foreign tenant UUIDs to untrusted clients.
   - **Improper URL Error Mapping:** When `chi.URLParam(r, "org")` was an invalid UUID, `uuid.Parse` returned an error that was also surfaced as HTTP 500 instead of HTTP 400 Bad Request.

---

## 3. Implementation Changes

### 3.1 Centralized Error Sanitizer (`handleLabError`)
In `connect-main/services/api/internal/lab/handler.go`, implemented `handleLabError`:

```go
var (
	errInvalidOrgID    = errors.New("invalid organization id")
	errInvalidUserID   = errors.New("invalid user id in session")
	errUnauthenticated = errors.New("authentication required")
)

// handleLabError translates database and internal errors into safe, client-facing HTTP responses.
// Authorization and cross-tenant failures (e.g. SQLSTATE 42501, 28000) are mapped to HTTP 403 Forbidden.
// Validation and malformed UUID errors are mapped to HTTP 400 Bad Request.
// Missing resources are mapped to HTTP 404 Not Found.
// Genuine internal errors return HTTP 500 without leaking raw SQL, SQLSTATE codes, or internal database UUIDs.
func (h *Handler) handleLabError(w http.ResponseWriter, r *http.Request, err error) {
	if err == nil {
		return
	}

	if errors.Is(err, errInvalidOrgID) {
		writeError(w, http.StatusBadRequest, "invalid organization id")
		return
	}

	if errors.Is(err, errUnauthenticated) || errors.Is(err, errInvalidUserID) {
		writeError(w, http.StatusUnauthorized, "authentication required")
		return
	}

	if errors.Is(err, pgx.ErrNoRows) {
		writeError(w, http.StatusNotFound, "resource not found")
		return
	}

	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) {
		switch pgErr.Code {
		case "42501", "28000":
			writeError(w, http.StatusForbidden, "you do not have permission to access this organization's resources")
			return
		case "23505":
			writeError(w, http.StatusConflict, "resource already exists")
			return
		case "23503", "23514", "22P02", "P0001":
			writeError(w, http.StatusBadRequest, "invalid request data or referenced entity not found")
			return
		case "CN404":
			writeError(w, http.StatusNotFound, "resource not found")
			return
		}
	}

	if strings.Contains(err.Error(), "token hash is required") {
		writeError(w, http.StatusUnauthorized, "authentication required")
		return
	}

	// Fallback for genuine internal server errors: safe generic error message.
	writeError(w, http.StatusInternalServerError, "an unexpected internal error occurred")
}
```

### 3.2 Handlers Hardened
Replaced raw `writeError(w, http.StatusInternalServerError, err.Error())` with `h.handleLabError(w, r, err)` across all 13 lab endpoints:
1. `listCourses` (`GET /organizations/{org}/lab/courses`)
2. `getCourse` (`GET /organizations/{org}/lab/courses/{slug}`)
3. `listModules` (`GET /organizations/{org}/lab/courses/{slug}/modules`)
4. `getExercise` (`GET /organizations/{org}/lab/exercises/{id}`)
5. `submitExercise` (`POST /organizations/{org}/lab/exercises/{id}/submit`)
6. `listAssignments` (`GET /organizations/{org}/lab/assignments`)
7. `getAssignment` (`GET /organizations/{org}/lab/assignments/{id}`)
8. `createAssignment` (`POST /organizations/{org}/lab/assignments`)
9. `submitAssignment` (`POST /organizations/{org}/lab/assignments/{id}/submit`)
10. `listSubmissions` (`GET /organizations/{org}/lab/assignments/{id}/submissions`)
11. `gradeSubmission` (`POST /organizations/{org}/lab/submissions/{id}/grade`)
12. `getProgress` (`GET /organizations/{org}/lab/progress`)
13. `getFacultyOverview` (`GET /organizations/{org}/lab/faculty/overview`)

### 3.3 Testability & Dependency Injection
Added optional `withAuthCtxFn` hook in `lab.Handler` defaulting to `database.WithAuthContext`, enabling robust, deterministic unit and regression testing of database session errors without running a live database.

---

## 4. Comprehensive Go API Handler Audit

We inspected all Go HTTP handlers across `connect-main/services/api/internal/` for patterns that expose internal database errors or stack traces to clients.

### Findings Table

| File & Handler | Error Source | Current Response Behavior | Security Impact | Correction Necessary |
| :--- | :--- | :--- | :--- | :--- |
| `internal/lab/handler.go` (13 handlers) | `database.WithAuthContext` / `repo.*` | Previously returned HTTP 500 with `err.Error()` leaking SQLSTATE 42501 and internal UUIDs | **HIGH** (Information disclosure, schema details, inappropriate error code) | **YES — FIXED in Phase 4.18** |
| `internal/institution/handler.go` (`sendError`) | `pgconn.PgError`, `pgx.ErrNoRows` | Maps `42501`/`28000` $\to$ 403 `FORBIDDEN`, `23505` $\to$ 409 `ALREADY_EXISTS`, `23503` $\to$ 400 `VALIDATION_FAILED`, fallback $\to$ generic 500 `INTERNAL_ERROR` | None. Proper error abstraction already in place. | **NO** |
| `internal/room/handlers.go` (`sendScheduleError`, `sendRoleError`) | Room scheduling & role management | Maps known errors to 403/404/409; fallback returns generic 500 `INTERNAL_ERROR` ("This could not be completed.") | None. No SQL/database leaks. | **NO** |
| `internal/auth/handlers.go` (`Signup`, `Login`) | Auth service | Checks `errors.Is(err, ErrEmailTaken)` $\to$ 409, `ErrInvalidEmail` $\to$ 400; unexpected $\to$ generic 500 ("Failed to process registration") | None. Only predefined sentinel error strings returned. | **NO** |
| `internal/notes/handler.go` (`GetNote`, `UpdateNote`) | Notes service | Maps `ErrUnauthorized` $\to$ 403, `ErrRevisionConflict` $\to$ 409; fallback returns generic 500 ("Failed to save notes.") | None. No SQL/database leaks. | **NO** |
| `internal/files/handler.go` (`UploadFile`, `DownloadFile`, `DeleteFile`) | File service / R2 | Maps typed errors to 400/403/404/409/422/423; fallback returns generic 500 ("Failed to download file.") | None. No SQL/database leaks. | **NO** |
| `internal/avatars/handler.go` (`Upload`, `Remove`, `Serve`) | Avatar storage | Returns 400/401/404; fallback returns generic 500 ("Could not save your picture.") | None. No SQL/database leaks. | **NO** |
| `internal/meetings/handler.go` (`search`, `detail`) | Meeting queries | Fallback returns generic 500 `INTERNAL_ERROR` ("Could not search meetings.", "Could not load this meeting.") | None. No SQL/database leaks. | **NO** |
| `internal/meeting/p2p/handler.go` (`ServeWS`) | P2P WebSocket authentication | Returns `http.Error(w, "unauthorized: "+err.Error(), 401)` where `err` is a static sentinel ("authentication required for p2p signaling", "invalid or expired guest credential", "no access to this room") | Minimal/Acceptable. No SQL or database internals. | **NO** |

---

## 5. Regression Test Coverage & Exact Results

In `connect-main/services/api/internal/lab/handler_test.go`, authored `TestHandler_AuthorizationErrorHardening` covering all 7 required scenarios:

```go
=== RUN   TestHandler_AuthorizationErrorHardening
=== RUN   TestHandler_AuthorizationErrorHardening/Active_organization_member_can_access_authorized_lab_resources
=== RUN   TestHandler_AuthorizationErrorHardening/User_without_active_membership_receives_403_Forbidden_without_SQLSTATE_or_UUID_leaks
=== RUN   TestHandler_AuthorizationErrorHardening/Cross-tenant_request_does_not_execute_protected_lab_repository_query
=== RUN   TestHandler_AuthorizationErrorHardening/Genuine_database_failure_returns_HTTP_500_with_generic_message
=== RUN   TestHandler_AuthorizationErrorHardening/Invalid_organization_UUID_returns_HTTP_400_Bad_Request
=== RUN   TestHandler_AuthorizationErrorHardening/Role_permission_boundaries:_students_cannot_create_assignments_or_view_faculty_overview
=== RUN   TestHandler_AuthorizationErrorHardening/Hidden-test_masking_and_student_self-grading_protections_remain_intact
--- PASS: TestHandler_AuthorizationErrorHardening (0.00s)
    --- PASS: TestHandler_AuthorizationErrorHardening/Active_organization_member_can_access_authorized_lab_resources (0.00s)
    --- PASS: TestHandler_AuthorizationErrorHardening/User_without_active_membership_receives_403_Forbidden_without_SQLSTATE_or_UUID_leaks (0.00s)
    --- PASS: TestHandler_AuthorizationErrorHardening/Cross-tenant_request_does_not_execute_protected_lab_repository_query (0.00s)
    --- PASS: TestHandler_AuthorizationErrorHardening/Genuine_database_failure_returns_HTTP_500_with_generic_message (0.00s)
    --- PASS: TestHandler_AuthorizationErrorHardening/Invalid_organization_UUID_returns_HTTP_400_Bad_Request (0.00s)
    --- PASS: TestHandler_AuthorizationErrorHardening/Role_permission_boundaries:_students_cannot_create_assignments_or_view_faculty_overview (0.00s)
    --- PASS: TestHandler_AuthorizationErrorHardening/Hidden-test_masking_and_student_self-grading_protections_remain_intact (0.00s)
```

### Overall Go Test Suite Execution
Executed `go test ./...` across the entire `services/api` backend:
```bash
$ cd connect-main/services/api && /Users/quantum/.local/bin/go test ./...
ok  	github.com/tathastu/connect/services/api/cmd/backfill_tenancy	(cached)
ok  	github.com/tathastu/connect/services/api/cmd/run_migration	(cached)
ok  	github.com/tathastu/connect/services/api/cmd/server	(cached)
ok  	github.com/tathastu/connect/services/api/internal/academic	(cached)
ok  	github.com/tathastu/connect/services/api/internal/aiproviders	(cached)
ok  	github.com/tathastu/connect/services/api/internal/attendance	(cached)
ok  	github.com/tathastu/connect/services/api/internal/auth	(cached)
ok  	github.com/tathastu/connect/services/api/internal/avatars	(cached)
ok  	github.com/tathastu/connect/services/api/internal/config	(cached)
ok  	github.com/tathastu/connect/services/api/internal/database	(cached)
ok  	github.com/tathastu/connect/services/api/internal/files	(cached)
ok  	github.com/tathastu/connect/services/api/internal/institution	(cached)
ok  	github.com/tathastu/connect/services/api/internal/lab	0.547s
ok  	github.com/tathastu/connect/services/api/internal/livekit	(cached)
ok  	github.com/tathastu/connect/services/api/internal/meeting/p2p	(cached)
ok  	github.com/tathastu/connect/services/api/internal/meetings	(cached)
ok  	github.com/tathastu/connect/services/api/internal/middleware	(cached)
ok  	github.com/tathastu/connect/services/api/internal/notes	(cached)
ok  	github.com/tathastu/connect/services/api/internal/redis	(cached)
ok  	github.com/tathastu/connect/services/api/internal/room	(cached)
ok  	github.com/tathastu/connect/services/api/internal/server	0.999s
ok  	github.com/tathastu/connect/services/api/internal/worker	(cached)
```

Executed `go vet ./...` and `go fmt`:
```bash
$ cd connect-main/services/api && /Users/quantum/.local/bin/go vet ./...
# Code exited with 0. Zero warnings.
```

---

## 6. Native Android Build Feasibility Report

### 6.1 Toolchain Investigation
- **Project Versions:**
  - React Native: `0.76.7`
  - Expo SDK: `~52.0.49`
  - Gradle Wrapper: `8.10.2` (`gradle/wrapper/gradle-wrapper.properties`)
  - Target SDK: `34`, Compile SDK: `35`, NDK: `26.1.10909125`
- **Installed JDK Environments:**
  1. Android Studio JBR: `/Applications/Android Studio.app/Contents/jbr/Contents/Home` $\to$ **OpenJDK 25.0.3**.
  2. JetBrains Runtime 21: `/Users/quantum/Library/Java/JavaVirtualMachines/jbr-21.0.11/Contents/Home` $\to$ **OpenJDK 21.0.11**.

### 6.2 Compatibility Test with OpenJDK 25
When attempting Gradle configuration with OpenJDK 25 (`JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"`):
```text
FAILURE: Build failed with an exception.

* Where:
Settings file '/Users/quantum/Desktop/connect/connect-main/apps/mobile/android/settings.gradle' line: 4

* What went wrong:
Error resolving plugin [id: 'com.facebook.react.settings']
> 25.0.3
```
**Blocker Identified:** React Native Gradle Plugin (`com.facebook.react.settings`) and Gradle 8.10.2 are strictly incompatible with OpenJDK 25.0.3, failing at initial settings evaluation.

### 6.3 Resolution & Successful Build with OpenJDK 21
When targeting the compatible JDK 21 toolchain (`JAVA_HOME="/Users/quantum/Library/Java/JavaVirtualMachines/jbr-21.0.11/Contents/Home"`):
```bash
$ cd connect-main/apps/mobile/android && JAVA_HOME="/Users/quantum/Library/Java/JavaVirtualMachines/jbr-21.0.11/Contents/Home" sh gradlew assembleDebug -x lint
...
BUILD SUCCESSFUL in 39s
801 actionable tasks: 276 executed, 525 up-to-date
```
**Conclusion:** Native Android compilation is **100% feasible and fully functional** on the development workstation by designating JDK 21 as `JAVA_HOME`. No changes to mobile source code or device configuration were made.

---

## 7. Remaining Risks & Operational Guidance

1. **Deploy Approval Gate:** The Go backend code changes are committed locally on `main` and validated against all unit, vet, and regression tests. As mandated by Phase 4.18 safety constraints, no automated deploy was triggered against Render. A human release engineer may trigger the Render build at the next scheduled release window.
2. **Backward Compatibility:** All existing HTTP client code (such as `apiFetch` in `@/lib/api/client.ts`) and existing error handling mechanisms remain fully compatible because error responses continue to supply the standard `{"error": "..."}` JSON payload.
3. **Database Integrity:** PostgreSQL row-level security and `connect_auth.authenticate_session` continue to enforce strict, fail-closed isolation at the transaction level.

---

## 8. Git Commit & Verification

- **Staged Files:**
  - `connect-main/services/api/internal/lab/handler.go`
  - `connect-main/services/api/internal/lab/handler_test.go`
  - `docs/qa/PHASE_4_18_AUTHORIZATION_ERROR_HARDENING.md`
- **Untouched / Preserved Files:**
  - `connect-main/apps/mobile/src/screens/MeetingScreen.tsx`
  - `connect-main/apps/mobile/src/services/apiClient.ts`
  - `connect-main/apps/mobile/src/screens/ClassroomSheet.tsx`
- **Production Confirmation:** Explicit confirmation that Render, Vercel, Neon, LiveKit, and Cloudflare production configurations, databases, and environments were **NOT** modified.
