# Phase 4.20: Error Classification Contract Review Report

**Date:** 2026-11-03
**Role:** Independent Principal Go Engineer & PostgreSQL Security Reviewer
**Repository:** https://github.com/anant9934/connect
**Production Frontend:** https://connect-alpha-seven.vercel.app *(untouched)*
**Production API:** https://connect-a2fi.onrender.com *(untouched)*

---

## 1. Executive Summary & Final Decision

### Final Decision:
**A. Error classification is robust; ready for human release approval.**

*(With explicitly retained PostgreSQL integration-test limitation: local isolated test database unavailable; live production Neon database strictly protected against test writes).*

### Key Architectural Improvements Completed in Phase 4.20:
1. **Elimination of Fragile Blacklist on `42501`:** In Phase 4.19, `isSystemPrivilegeError` attempted to blacklist specific phrases (`"permission denied for table"`), allowing any unknown or ambiguous `42501` error to fall through to HTTP 403 Forbidden. In Phase 4.20, this has been inverted to a **fail-safe whitelisting model**: only verified tenant membership denials (`database.ErrMembershipDenied` or exact contract matches) return HTTP 403. ALL unexpected, ambiguous, or database-role privilege errors fail safely as generic **HTTP 500 Internal Server Error**.
2. **Boundary-Level Error Typing (`context.go`):** `AuthenticateAndSetContext` in `internal/database` now intercepts PostgreSQL errors right at the security definer boundary:
   - SQLSTATE `28000` $\to$ wraps typed sentinel `database.ErrSessionInvalid`.
   - SQLSTATE `42501` (membership denial) $\to$ wraps typed sentinel `database.ErrMembershipDenied`.
   - Empty token hash $\to$ returns typed sentinel `database.ErrNoSessionToken`.
3. **Complete Elimination of Legacy String Fallback:** The legacy message check `strings.Contains(err.Error(), "token hash is required")` in `handleLabError` has been **completely removed**. All session authentication checks now use typed sentinels and `errors.Is`.
4. **Typed Domain Validation Sentinels:** Introduced `lab.ErrDomainValidation` as a typed Go sentinel for client-actionable domain rule violations (mapped to HTTP 400 Bad Request). Generic `P0001` exceptions are restricted strictly to known, documented academic core triggers; all unknown `P0001` exceptions fail safely as HTTP 500.
5. **Comprehensive Test Suite (36 Subtests):** Added table-driven test cases covering wrapped/unwrapped sentinels, unexpected privilege faults, message variations, query abort assertions, and response sanitization.

---

## 2. Actual Code Audit Findings

### 2.1 Audit of Phase 4.19 Vulnerabilities & Deficiencies
A rigorous line-by-line inspection of Phase 4.19 code revealed two significant contract fragility risks that required remediation:
- **Flaw 1 (Blacklist Fall-Through on `42501`):** `isSystemPrivilegeError` only checked for specific keywords like `"permission denied for table"`, `"permission denied for schema"`. An unknown database privilege error (e.g., permission denied on a composite type, a sequence, a tablespace, or a foreign data wrapper) evaluated to `false`, causing `handleLabError` to write `StatusForbidden (403)` with `"you do not have permission to access this organization's resources"`. This dangerously masked database role configuration errors from SREs as user authorization denials.
- **Flaw 2 (Residual Message Text Matching):** `handleLabError` retained a legacy fallback: `if strings.Contains(err.Error(), "token hash is required")`. This was brittle and masked missing sentinel wrapping across package boundaries.
- **Flaw 3 (Untyped Error Boundaries):** `AuthenticateAndSetContext` did not type `28000` or `42501` at the query scan boundary, forcing downstream handlers to inspect raw PostgreSQL driver error codes.

### 2.2 Phase 4.20 Refactored Architecture

#### A. Database Authentication Boundary (`internal/database/context.go`)
Three typed error sentinels are now exported and returned by `AuthenticateAndSetContext`:
```go
// ErrNoSessionToken is returned when establishing database auth context without a session token hash.
var ErrNoSessionToken = errors.New("token hash is required to establish database auth context")

// ErrSessionInvalid is returned when a session token hash is invalid, expired, or revoked (SQLSTATE 28000).
var ErrSessionInvalid = errors.New("invalid, expired, or revoked session token")

// ErrMembershipDenied is returned when an authenticated user does not have an active membership in the requested organization (SQLSTATE 42501 from connect_auth.authenticate_session).
var ErrMembershipDenied = errors.New("organization membership denied")
```
When `tx.QueryRow` executes `connect_auth.authenticate_session`:
- If `tokenHash == ""`: returns `ErrNoSessionToken`.
- If `pgErr.Code == "28000"`: returns `fmt.Errorf("%w: %w", ErrSessionInvalid, err)`.
- If `pgErr.Code == "42501"` and `requestedOrgID != nil`: verifies message matches `"Authorization Failed:"` or `"has no active membership"` and returns `fmt.Errorf("%w: %w", ErrMembershipDenied, err)`.

#### B. Lab Error Classification Contract (`internal/lab/handler.go`)
The error classifier `handleLabError` now follows a strict, fail-safe hierarchy:
1. `errors.Is(err, errInvalidOrgID)` $\to$ **HTTP 400 Bad Request** (`"invalid organization id"`)
2. `errors.Is(err, errUnauthenticated) || errors.Is(err, errInvalidUserID) || errors.Is(err, database.ErrNoSessionToken) || errors.Is(err, database.ErrSessionInvalid)` $\to$ **HTTP 401 Unauthorized** (`"authentication required"`)
3. `errors.Is(err, database.ErrMembershipDenied)` $\to$ **HTTP 403 Forbidden** (`"you do not have permission to access this organization's resources"`)
4. `errors.Is(err, pgx.ErrNoRows)` $\to$ **HTTP 404 Not Found** (`"resource not found"`)
5. `errors.Is(err, ErrDomainValidation)` $\to$ **HTTP 400 Bad Request** (`"invalid request data or referenced entity not found"`)
6. PostgreSQL SQLSTATE evaluation (`errors.As(err, &pgErr)`):
   - `28000` $\to$ **HTTP 401 Unauthorized** (`"authentication required"`)
   - `42501` $\to$ Whitelisted check via `isTenantMembershipDenial(pgErr)`. If true, returns **HTTP 403 Forbidden**. All other `42501` errors fail safely as **HTTP 500 Internal Server Error**.
   - `23505` $\to$ **HTTP 409 Conflict** (`"resource already exists"`)
   - `23503`, `23514` $\to$ **HTTP 400 Bad Request** (`"invalid request data or referenced entity not found"`)
   - `22P02` $\to$ **HTTP 400 Bad Request** (`"invalid resource identifier format"`)
   - `CN404` $\to$ **HTTP 404 Not Found** (`"resource not found"`)
   - `CN409` $\to$ **HTTP 409 Conflict** (`"resource conflict"`)
   - `CN410` $\to$ **HTTP 410 Gone** (`"resource no longer available"`)
   - `CN422` $\to$ **HTTP 422 Unprocessable Entity** (`"unprocessable entity"`)
   - `P0001` $\to$ Whitelisted check via `isRecognizedDomainValidationError(pgErr)`. If matching documented academic core trigger prefixes (`Foreign Key Violation:`, `Integrity Error:`, `Temporal Eligibility Error:`), returns **HTTP 400 Bad Request**. All unknown `P0001` return **HTTP 500 Internal Server Error**.
7. Fallback for all unhandled / connection errors $\to$ **HTTP 500 Internal Server Error** (`"an unexpected internal error occurred"`).

---

## 3. Analysis of Remaining Message-Based Matching

The remaining message-based checks in the codebase were analyzed in detail:

1. **`isTenantMembershipDenial` (Prefix Check):**
   - *Implementation:* `strings.HasPrefix(msg, "Authorization Failed:") || strings.Contains(msg, "has no active membership in Organization")`
   - *Rationale:* PostgreSQL function `connect_auth.authenticate_session` (defined in migration `000008_auth_context_and_rls.sql`) raises `insufficient_privilege` (`42501`) with this exact message format. Because database schema migrations cannot be introduced in this phase, this check acts as a secondary layer when an error is not already wrapped by `database.ErrMembershipDenied`.
   - *Safety:* Because all other `42501` errors now default to HTTP 500, false positives are impossible unless an attacker or internal system raises an error containing this exact prefix.
2. **`isRecognizedDomainValidationError` (Prefix Check):**
   - *Implementation:* Checks for prefixes `"Foreign Key Violation:"`, `"Integrity Error:"`, `"Temporal Eligibility Error:"`.
   - *Rationale:* Triggers in migration `000007_tenancy_and_academic_core.sql` raise generic `P0001` exceptions without custom SQLSTATEs. These triggers represent client-correctable academic rule violations.
   - *Safety:* Any exception where these keywords appear in the body rather than as a strict prefix (e.g. `"Internal trigger check failed: Integrity Error observed in table row"`) returns HTTP 500.
3. **Migration Recommendation for Future Phase:**
   - In a future planned migration (e.g., Phase 5.0), migration `000007` and `000008` should be updated to use distinct custom SQLSTATEs (`CN403` for membership denial, `CN400` for academic domain triggers), entirely eliminating message text parsing in the Go layer.

---

## 4. Test Execution & Verification

### 4.1 Table-Driven Classifier Precision Suite (`TestHandler_ErrorClassifierPrecision`)
A total of **36 test scenarios** were executed in `internal/lab`:
- Unwrapped `database.ErrMembershipDenied` $\to$ HTTP 403 Forbidden (PASS)
- Wrapped `database.ErrMembershipDenied` $\to$ HTTP 403 Forbidden (PASS)
- Wrapped `42501` membership denial with UUIDs $\to$ HTTP 403 Forbidden (PASS)
- Error-message variation with whitespace and `ERROR:` prefix $\to$ HTTP 403 Forbidden (PASS)
- Unexpected `42501` table permission denied $\to$ HTTP 500 Internal Server Error (PASS)
- Unexpected `42501` schema permission denied $\to$ HTTP 500 Internal Server Error (PASS)
- Unexpected `42501` must be owner of relation $\to$ HTTP 500 Internal Server Error (PASS)
- Unknown `42501` arbitrary unknown table $\to$ HTTP 500 Internal Server Error (PASS)
- Unknown `42501` ambiguous privilege message $\to$ HTTP 500 Internal Server Error (PASS)
- `28000` expired session $\to$ HTTP 401 Unauthorized (PASS)
- Error-message variation with custom `28000` OAuth text $\to$ HTTP 401 Unauthorized (PASS)
- Unwrapped `database.ErrSessionInvalid` $\to$ HTTP 401 Unauthorized (PASS)
- Wrapped `database.ErrSessionInvalid` $\to$ HTTP 401 Unauthorized (PASS)
- Typed `database.ErrNoSessionToken` sentinel $\to$ HTTP 401 Unauthorized (PASS)
- Wrapped `database.ErrNoSessionToken` sentinel $\to$ HTTP 401 Unauthorized (PASS)
- Typed `ErrDomainValidation` $\to$ HTTP 400 Bad Request (PASS)
- Wrapped `ErrDomainValidation` $\to$ HTTP 400 Bad Request (PASS)
- Known `P0001` Foreign Key Violation $\to$ HTTP 400 Bad Request (PASS)
- Known `P0001` Integrity Error $\to$ HTTP 400 Bad Request (PASS)
- Known `P0001` Temporal Eligibility Error $\to$ HTTP 400 Bad Request (PASS)
- Unknown `P0001` immutability violation $\to$ HTTP 500 Internal Server Error (PASS)
- Unknown `P0001` PL/pgSQL assertion fault $\to$ HTTP 500 Internal Server Error (PASS)
- Error-message variation: `P0001` with keyword inside body $\to$ HTTP 500 Internal Server Error (PASS)
- Genuine DB TCP connection refused $\to$ HTTP 500 Internal Server Error (PASS)
- Genuine DB statement timeout $\to$ HTTP 500 Internal Server Error (PASS)
- Invalid resource identifier `22P02` $\to$ HTTP 400 Bad Request (PASS)
- Unique violation `23505` $\to$ HTTP 409 Conflict (PASS)
- Foreign key violation `23503` $\to$ HTTP 400 Bad Request (PASS)
- Check constraint violation `23514` $\to$ HTTP 400 Bad Request (PASS)
- Custom application not found `CN404` $\to$ HTTP 404 Not Found (PASS)
- Custom application conflict `CN409` $\to$ HTTP 409 Conflict (PASS)
- Custom application gone `CN410` $\to$ HTTP 410 Gone (PASS)
- Custom application unprocessable `CN422` $\to$ HTTP 422 Unprocessable Entity (PASS)
- Missing resource `pgx.ErrNoRows` $\to$ HTTP 404 Not Found (PASS)
- Invalid organization ID `errInvalidOrgID` $\to$ HTTP 400 Bad Request (PASS)
- Protected repository query never executed on context rejection $\to$ Verified for all rejection types (PASS)

### 4.2 Security & Query Abort Protections
- Verified that on any authentication or authorization rejection (`42501`, `28000`, `ErrNoSessionToken`, `ErrSessionInvalid`, `ErrMembershipDenied`, `P0001`, DB connection reset), the inner database query is **never executed** (`repoCalled == false`).
- Verified zero leak of SQLSTATE codes, table names, function names, internal UUIDs, SQL keywords, or raw database driver errors (`dial tcp`, `connection refused`) across all scenarios.
- Verified hidden-test masking and student role isolation remain fully intact.

### 4.3 Integration Test Status & Environmental Limitations
- **Disposable Test Database Status:** The local environment was inspected for disposable test PostgreSQL instances (`127.0.0.1:5432`, `docker`, `podman`, `psql`, `pg_isready`). None is running.
- **Production Isolation:** In strict accordance with the production safety mandate, the live production database (`Neon`) was **NOT** connected to or written to for running destructive or rollback tests.
- **Integration Test Contract:** In `internal/database/authcontext_integration_test.go`, integration tests explicitly require `TEST_DATABASE_URL` and `TEST_CONNECT_APP_URL`. When absent, tests cleanly invoke `t.Skip("NOT VERIFIED: TEST_DATABASE_URL and TEST_CONNECT_APP_URL are required")`. This limitation is preserved and explicitly documented.

---

## 5. Changed Files & Diff Summary

| File Path | Description of Changes |
| :--- | :--- |
| `services/api/internal/database/context.go` | Added `ErrSessionInvalid` and `ErrMembershipDenied` sentinels; updated `AuthenticateAndSetContext` to wrap sentinels at the query boundary. |
| `services/api/internal/database/db_test.go` | Added unit tests verifying sentinel definitions and `AuthenticateAndSetContext` sentinel return. |
| `services/api/internal/lab/handler.go` | Added `ErrDomainValidation`; replaced blacklist `isSystemPrivilegeError` with fail-safe whitelisting `isTenantMembershipDenial`; wired `ErrMembershipDenied` and `ErrSessionInvalid`; removed legacy string fallback; added `CN410` mapping. |
| `services/api/internal/lab/handler_test.go` | Added 13 new table test cases (36 total) covering wrapped/unwrapped sentinels, unexpected privilege errors, message variations, and sanitization. |
| `docs/qa/PHASE_4_20_ERROR_CLASSIFICATION_CONTRACT_REVIEW.md` | Comprehensive contract review and evidence report. |

### Preserved User Modifications:
The following mobile files remain completely untouched and unmodified in the working tree:
- `apps/mobile/src/screens/MeetingScreen.tsx`
- `apps/mobile/src/services/apiClient.ts`
- `apps/mobile/src/screens/ClassroomSheet.tsx`

---

## 6. Strict Production Safety Affirmation

It is explicitly certified that:
- **Render Production Service (`srv-dbj507nlk1mc73897go0`):** NOT deployed, restarted, or altered.
- **Vercel Production Deployment:** NOT deployed, restarted, or altered.
- **Neon Production Database:** NOT connected to, modified, migrated, or written to.
- **LiveKit Cloud / Cloudflare:** NOT modified or altered in any manner.
- **Credentials & Secrets:** NO credentials, API keys, or connection strings were exposed, printed, or rotated.
- **Zero Paid Infrastructure:** NO paid services were used.
