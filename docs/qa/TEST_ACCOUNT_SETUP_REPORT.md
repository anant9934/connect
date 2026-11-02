# Connect — Dedicated Test Profile Setup & Manual QA Report

**Role:** Senior Full-Stack Engineer & Application QA Lead
**Date:** November 3, 2026
**Environment:** Production
**Production Web Application:** `https://connect-alpha-seven.vercel.app`
**Backend API Service:** `https://connect-a2fi.onrender.com`
**Database Cluster:** Neon PostgreSQL (`ep-sweet-block-b4g7rmvt`)
**Account Status:** `VERIFIED & OPERATIONAL`

---

## 1. Executive Summary

A dedicated manual QA student profile has been provisioned and verified on the live production Connect platform. Account registration was completed end-to-end through the official production authentication pipeline (`POST /api/v1/auth/signup` via Next.js proxy rewrite) without bypassing application security controls, password hashing routines, CSRF defenses, or database Row Level Security (RLS).

### Account Identity Matrix

| Attribute | Production Value |
| :--- | :--- |
| **Email Address** | `connect.qa.student@example.com` |
| **Display Name** | `Connect QA Student` |
| **User ID** | `44ba9712-3fa4-4008-b672-016bec79409e` |
| **Role** | `Student` (Default individual learner) |
| **Password Hashing** | Argon2id (`v=19`, `m=65536`, `t=3`, `p=2`) |
| **Session Cookie** | `__Host-tc_session` (Secure, HttpOnly, SameSite=Lax, Path=/) |
| **Account Status** | `active` |
| **Password** | `[REDACTED — DELIVERED SECURELY IN PRIVATE CHAT RESPONSE]` |

---

## 2. Authentication System Architecture & Safety Audit

Prior to account creation, the Connect authentication architecture was inspected across both backend and frontend codebases:

1. **Registration & Login Pipeline**:
   - Web application client ([`apps/web/features/auth/api.ts`](file:///Users/quantum/Desktop/connect/connect-main/apps/web/features/auth/api.ts)) submits registration requests to `/api/v1/auth/signup`.
   - Vercel reverse proxy rewrites proxy `/api/v1/:path*` directly to the active Go API service on Render ([`next.config.mjs`](file:///Users/quantum/Desktop/connect/connect-main/apps/web/next.config.mjs)).
   - Password hashing strictly enforces Argon2id parameters ([`services/api/internal/auth/password.go`](file:///Users/quantum/Desktop/connect/connect-main/services/api/internal/auth/password.go)).
   - Constant-time verification is performed against user enumeration attacks via precomputed dummy hashes.
2. **Role-Based Access Control (RBAC)**:
   - System administrators are stored in `public.platform_administrators`.
   - Institution roles (`institution_admin`, `faculty`, `student`) are managed via `public.organization_memberships`.
   - Individual registered users without organization assignments default to the `Student` role.
   - Verified that the new QA user has **0 rows** in `platform_administrators` and **0 rows** in `organization_memberships`, guaranteeing strictly non-privileged access.
3. **CSRF & Origin Enforcement**:
   - All state-changing endpoints (`POST`, `PATCH`, `DELETE`) require an allowed `Origin` or `Referer` matching `https://connect-alpha-seven.vercel.app` ([`services/api/internal/middleware/csrf.go`](file:///Users/quantum/Desktop/connect/connect-main/services/api/internal/middleware/csrf.go)).
4. **Data Integrity & Non-Interference**:
   - Prior to execution: 5 users existed in `public.users`.
   - Post execution: exactly 6 users exist in `public.users`.
   - Zero pre-existing user records, academic records, attendance records, or institution configurations were altered.

---

## 3. End-to-End Verification Test Results

All tests were executed against the live production deployment (`https://connect-alpha-seven.vercel.app`):

| Test ID | Test Scenario | Method / Endpoint | Expected Result | Actual Result | Status |
| :---: | :--- | :--- | :--- | :--- | :---: |
| **TC-01** | Account Registration | `POST /api/v1/auth/signup` | HTTP 201 Created, user object returned | HTTP 201, User ID `44ba9712...` returned | **PASS** |
| **TC-02** | Session Cookie Issuance | Response Header: `Set-Cookie` | Cookie `__Host-tc_session` established | Cookie present with Secure & HttpOnly flags | **PASS** |
| **TC-03** | Authenticated Session Query | `GET /api/v1/auth/session` | HTTP 200, user identity matches | HTTP 200, `connect.qa.student@example.com` | **PASS** |
| **TC-04** | User Profile Retrieval | `GET /api/v1/users/me/profile`| HTTP 200, profile DTO returned | HTTP 200, DisplayName `Connect QA Student` | **PASS** |
| **TC-05** | User Logout Flow | `POST /api/v1/auth/logout` | HTTP 200, session revoked | HTTP 200 `{"success":true}` | **PASS** |
| **TC-06** | Post-Logout Session Denial | `GET /api/v1/auth/session` | HTTP 401 UNAUTHENTICATED | HTTP 401 `{"code":"UNAUTHENTICATED"}` | **PASS** |
| **TC-07** | Re-Authentication (Login) | `POST /api/v1/auth/login` | HTTP 200, fresh session token | HTTP 200, fresh session established | **PASS** |
| **TC-08** | Repeated Session Validation| `GET /api/v1/auth/session` | HTTP 200, active identity restored | HTTP 200, active session confirmed | **PASS** |
| **TC-09** | Student Dashboard Loading | `GET /lab/dashboard` | HTTP 200, student dashboard renders | HTTP 200 (30,536 bytes rendered) | **PASS** |
| **TC-10** | Profile Management Route | `GET /profile` | HTTP 200, profile page rendered | HTTP 200 (15,966 bytes rendered) | **PASS** |
| **TC-11** | Scheduler Route | `GET /schedule` | HTTP 200, schedule UI rendered | HTTP 200 (16,142 bytes rendered) | **PASS** |
| **TC-12** | Meeting History Route | `GET /history` | HTTP 200, history UI rendered | HTTP 200 (16,024 bytes rendered) | **PASS** |
| **TC-13** | Notifications Route | `GET /notifications` | HTTP 200, notifications UI rendered| HTTP 200 (16,167 bytes rendered) | **PASS** |
| **TC-14** | Admin Boundary Isolation | `GET /admin` | HTTP 200, access barred | "You do not manage any organizations yet." | **PASS** |
| **TC-15** | Faculty Hub Boundary | `GET /lab/faculty` | HTTP 200, read-only portal view | Portal rendered without grading permissions | **PASS** |

---

## 4. Manual QA Readiness & Feature Verification Checklist

For manual QA testing using this account, navigate to:
**Login URL:** `https://connect-alpha-seven.vercel.app/sign-in`

### Test Checklist & Operational Boundaries

```text
[✓] 1. Authentication & Sessions
    - Login: Enter credentials on /sign-in -> Redirects to homepage/dashboard.
    - Session Persistence: Reloading page preserves active user state.
    - Logout: Profile menu -> Sign out clears session and redirects to landing page.

[✓] 2. Student Lab & Learning Hub
    - Lab Directory: Navigate to /lab -> Course list is accessible.
    - Student Dashboard: Navigate to /lab/dashboard -> Progress and streak UI visible.
    - Code Editor: Navigate to /lab/editor -> Python WebWorker and web runtimes execute locally.
    - SQL Lab: Navigate to /lab/sql -> SQLite WebAssembly playground executes locally.

[✓] 3. Profile & Account Settings
    - Profile Details: Navigate to /profile -> View email and display name.
    - Display Name Update: Edit display name -> Saved and persisted.

[✓] 4. Meeting & Room Participation
    - Instant Meeting: "Start Meeting" from home -> Enters meeting preview and room.
    - Join by Code: Enter meeting passcode -> Room join flow initiates.

[⚠] 5. Known Integration Boundaries
    - Institution Administration: /admin strictly displays empty state (Student has no admin privileges).
    - Faculty Grading: /lab/faculty operates in viewer mode; submitting faculty grades requires a Faculty role.
    - Password Recovery: Email delivery remains disabled pending third-party SMTP provider approval.
```

---

## 5. Account Cleanup Procedure

When manual QA testing concludes, the test account can be deactivated or deleted via direct database administration or via the API:

### Option A: SQL Deletion (Neon Admin)
```sql
-- Remove session tokens and user record
DELETE FROM public.sessions WHERE user_id = '44ba9712-3fa4-4008-b672-016bec79409e';
DELETE FROM public.users WHERE id = '44ba9712-3fa4-4008-b672-016bec79409e';
```

### Option B: Soft Deactivation
```sql
UPDATE public.users
SET status = 'deactivated', updated_at = clock_timestamp()
WHERE id = '44ba9712-3fa4-4008-b672-016bec79409e';
```
*(Deactivated status immediately causes `/api/v1/auth/login` to fail with `ACCOUNT_DISABLED`).*

