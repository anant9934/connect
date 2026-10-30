# M8 ACCOUNT BACKEND AND DATABASE MIGRATIONS
## Tathastu Meet — Go Microservice Architecture, Schema Evolutions & Endpoint Security

---

### Executive Summary

Milestone M8 establishes complete, server-authoritative account management in the Go API service (`services/api`). The implementation adds additive database migrations for profile metadata, user preferences, and Google OAuth credentials, accompanied by cryptographic security guarantees, session isolation, and Argon2id password verification.

---

### 1. Database Schema Migration

The migration `migrations/000005_user_profile_and_providers.sql` introduces non-destructive, backward-compatible evolutions to the `users` table:

```sql
-- Up Migration: migrations/000005_user_profile_and_providers.sql

-- 1. Support OAuth-only accounts by allowing nullable password hashes
ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;

-- 2. Add profile metadata fields
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_id VARCHAR(64);
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url TEXT;

-- 3. Add Google OAuth provider identity mapping
ALTER TABLE users ADD COLUMN IF NOT EXISTS google_id VARCHAR(128) UNIQUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS auth_provider VARCHAR(32) NOT NULL DEFAULT 'email';
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified BOOLEAN NOT NULL DEFAULT false;

-- 4. Add persistent user preferences storage
ALTER TABLE users ADD COLUMN IF NOT EXISTS preferences JSONB NOT NULL DEFAULT '{}'::jsonb;

-- 5. Performance indices
CREATE INDEX IF NOT EXISTS idx_users_google_id ON users(google_id) WHERE google_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_users_avatar_id ON users(avatar_id) WHERE avatar_id IS NOT NULL;
```

#### Schema Safety Principles:
- **Additive & Non-Destructive:** Existing users and hashed credentials are fully preserved.
- **Nullable Password Hash:** Enables Google-only users to exist without dummy passwords, while strictly enforcing password presence for email registrations.
- **Fast Lookup Indices:** Unique index on `google_id` prevents duplicate account creation or concurrency race conditions.

---

### 2. Implemented Backend Endpoints

All authenticated endpoints strictly extract identity from the validated cryptographic session token (`auth.GetUserID(r.Context())`). The backend **never** trusts client-supplied user IDs in request bodies or query parameters.

| HTTP Method | Route | Description | Auth Required | Request / Response Structure |
|---|---|---|---|---|
| `GET` | `/api/v1/users/me/profile` | Retrieves current user profile | **Yes (Session)** | Returns `UserProfile` with avatar, email, provider, preferences |
| `PATCH` | `/api/v1/users/me/profile` | Updates own display name or avatar | **Yes (Session)** | Accepts `{ displayName?, avatarId?, avatarUrl? }` |
| `POST` | `/api/v1/users/me/avatar` | Uploads custom profile picture | **Yes (Session)** | Multipart form data (5MB max, PNG/JPEG/WEBP) |
| `PUT` | `/api/v1/users/me/password` | Changes own password | **Yes (Session)** | Accepts `{ currentPassword, newPassword }` with Argon2id reauth |
| `PATCH` | `/api/v1/users/me/preferences` | Updates user defaults | **Yes (Session)** | Accepts `{ audioVideo?, notifications?, appearance? }` |
| `POST` | `/api/v1/auth/google` | Google sign-in / registration | **No (Public)** | Accepts `{ idToken }`, returns session token & profile |
| `POST` | `/api/v1/users/me/link/google` | Links Google to existing account | **Yes (Session)** | Accepts `{ idToken }`, verifies claims & updates `google_id` |

---

### 3. Go Architecture & Security Implementation

#### 3.1 Repository Layer (`internal/auth/repository.go`)
- `UpdateProfile(ctx, userID, displayName, avatarID, avatarURL)`: Atomically updates profile fields and touches `updated_at`.
- `UpdatePassword(ctx, userID, passwordHash)`: Updates password hash and updates `updated_at`.
- `GetUserByGoogleID(ctx, googleID)`: Resolves account by immutable Google subject identifier (`sub`).
- `LinkGoogleAccount(ctx, userID, googleID)`: Maps Google ID to an existing authenticated user.
- `UpdatePreferences(ctx, userID, prefsJSON)`: Stores sanitized JSON preferences.

#### 3.2 Service Layer (`internal/auth/service.go`)
- **Display Name Validation:** Enforces length between 2 and 50 characters, trims whitespace, prevents control characters and script injection.
- **Avatar ID Validation:** Restricts bundled avatar IDs to registered regex patterns (`^avatar_\d{2}$`) or validated HTTPS URLs.
- **Argon2id Verification:** Password verification uses established Argon2id parameters (`time=1, memory=64MB, threads=4, keyLen=32`).
- **Session Revocation:** Changing password or logging out immediately deletes or invalidates the active session record in PostgreSQL / Redis.

#### 3.3 Handler Layer (`internal/auth/handlers.go`)
- Handles HTTP decoding, enforces 1MB body limit on JSON requests, and maps domain errors to standard HTTP status codes (`400 Bad Request`, `401 Unauthorized`, `404 Not Found`, `409 Conflict`).

---

### 4. Backend Automated Test Results

The suite `profile_test.go` was executed against the Go auth service:

```
=== RUN   TestProfileUpdateAndRetrieval
--- PASS: TestProfileUpdateAndRetrieval (0.30s)
=== RUN   TestPasswordHashingAndVerification
--- PASS: TestPasswordHashingAndVerification (0.17s)
=== RUN   TestSignupSuccess
--- PASS: TestSignupSuccess (0.06s)
=== RUN   TestDuplicateEmailSafeHandling
--- PASS: TestDuplicateEmailSafeHandling (0.06s)
=== RUN   TestLoginSuccessAndSessionRotation
--- PASS: TestLoginSuccessAndSessionRotation (0.11s)
=== RUN   TestLoginWrongPasswordAndUnknownUser
--- PASS: TestLoginWrongPasswordAndUnknownUser (0.17s)
=== RUN   TestSessionExpiryAndIdleTimeout
--- PASS: TestSessionExpiryAndIdleTimeout (0.09s)
=== RUN   TestSessionRevocationAndLogout
--- PASS: TestSessionRevocationAndLogout (0.06s)
=== RUN   TestTamperedSessionToken
--- PASS: TestTamperedSessionToken (0.00s)
PASS
ok      github.com/tathastu/connect/services/api/internal/auth  1.02s
```

**Outcome:** 100% pass rate across all 9 authentication test suites.
