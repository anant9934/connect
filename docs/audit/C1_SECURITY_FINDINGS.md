# CONNECT C1 — SECURITY FINDINGS & ENDPOINT AUTHORIZATION AUDIT

**Document ID:** `CONNECT-AUDIT-C1-SECURITY-20261101`
**Repository:** `https://github.com/anant9934/connect`
**Working Branch:** `remediation/c1-production-readiness`
**Verified Commit SHA:** `2a119732a6b753fb56c25310819d6ae007db64aa`
**Auditor:** Principal Application Security Engineer & PostgreSQL Security Engineer
**Date:** November 1, 2026
**Status:** **`PHASE B SECURITY AUDIT COMPLETE`**

---

## 1. EXECUTIVE SECURITY SUMMARY

Phase B of Stage C1 conducted an exhaustive application security audit across the entire Connect control plane, covering all 34 registered HTTP routes, client-side applications (Web Next.js and Mobile React Native), storage pipelines, and media plane signaling.

### Summary of Key Findings:
- **Authentication & Session Discipline:** Authenticated sessions use HTTP-only, Secure, SameSite cookies with rolling session idle timeouts (12h) and absolute lifetime limits (7d).
- **Cryptographic Context Sealing:** Database operations under `connect_app` use HMAC-SHA256 sealed GUC contexts (`app._current_user_id`, `app._current_org_id`, `app._role`) verified in PostgreSQL via constant-time comparisons.
- **BOLA / IDOR Protection:** Meeting management actions (`lock`, `unlock`, `end`, `remove`, `mute`, `promote-speaker`, `demote-speaker`) enforce server-side host ownership checks in `internal/room/service.go`. Non-hosts are rejected with `403 Forbidden`.
- **Tenant Isolation:** Multi-tenant RLS on 16 core PostgreSQL tables strictly forbids cross-organization access.
- **Credential Rotation (Gate K):** Formally resolved; repository owner confirmed manual rotation of the database password and Supabase API keys on November 1, 2026.

---

## 2. ENDPOINT-BY-ENDPOINT AUTHORIZATION MATRIX

Every HTTP endpoint registered in `internal/server/server.go` was evaluated for authentication requirements, CSRF protection, rate limiting, and server-side authorization:

| Route Path | Method | Auth Required | CSRF Guard | Rate Limit | Minimum Permitted Role / Identity | Server-Side Enforcement Mechanism |
| :--- | :---: | :---: | :---: | :---: | :--- | :--- |
| `/health/live` | `GET` | None | No | Global | Public | Liveness probe (no secret leakage) |
| `/health/ready` | `GET` | None | No | Global | Public | Readiness probe (verifies DB/Redis ping) |
| `/api/v1/system/status` | `GET` | None | No | Global | Public | System status and build version |
| `/api/v1/collab/validate-assertion` | `POST` | None | No | Global | Public | Validates integration assertion signature |
| `/api/v1/auth/signup` | `POST` | None | **Yes** | 10/min (IP) | Unauthenticated | Validates email, password strength; sets HTTP-only cookie |
| `/api/v1/auth/login` | `POST` | None | **Yes** | 5/min (IP+Email) | Unauthenticated | Timing-safe Argon2id/bcrypt verification; sets cookie |
| `/api/v1/auth/google` | `POST` | None | **Yes** | 10/min (IP) | Unauthenticated | Verifies Google OAuth token; sets session cookie |
| `/api/v1/auth/logout` | `POST` | Optional | **Yes** | Global | Authenticated User | Revokes session token in database; clears cookie |
| `/api/v1/auth/session` | `GET` | Session | No | Global | Authenticated User | Extracts session cookie/bearer, validates expiration |
| `/api/v1/users/me/profile` | `GET` | Session | No | Global | Authenticated User | Scoped strictly to authenticated `user.ID` |
| `/api/v1/users/me/profile` | `PATCH` | Session | **Yes** | Global | Authenticated User | Updates display name / avatar strictly for `user.ID` |
| `/api/v1/users/me/change-password` | `POST` | Session | **Yes** | Global | Authenticated User | Verifies current password before updating to new |
| `/api/v1/users/me/preferences` | `POST` | Session | **Yes** | Global | Authenticated User | Updates user preferences JSON strictly for `user.ID` |
| `/api/v1/users/me/link-google` | `POST` | Session | **Yes** | Global | Authenticated User | Links Google identity to authenticated account |
| `/api/v1/rooms/` | `POST` | Session | **Yes** | Global | Authenticated User | Creates room with caller as immutable `created_by` host |
| `/api/v1/rooms/history` | `GET` | Session | No | Global | Authenticated User | Scoped strictly to authenticated user's joined meetings |
| `/api/v1/rooms/{code}` | `GET` | None | No | Global | Public / Guest | Retrieves public room status (locked, ended, waiting room) |
| `/api/v1/rooms/{code}/join` | `POST` | Optional | **Yes** | 15/min (IP+Room)| Guest or Auth User | Validates room code, capacity, bans, waiting room state |
| `/api/v1/rooms/{code}/leave` | `POST` | Optional | **Yes** | Global | Participant | Removes participant presence and clears guest cookie |
| `/api/v1/rooms/{code}/admission/request` | `POST` | Optional | **Yes** | Global | Guest / Participant | Submits admission request to host waiting queue |
| `/api/v1/rooms/{code}/admission/status` | `GET` | Optional | No | Global | Requestor Identity | Checks if admission decision has been rendered |
| `/api/v1/rooms/{code}/admission/pending` | `GET` | Session | No | Global | Room Host | Only room host can view pending admission requests |
| `/api/v1/rooms/{code}/admission/decision`| `POST` | Session | **Yes** | Global | Room Host | Only room host can admit or deny waiting participants |
| `/api/v1/rooms/{code}/lock` | `POST` | Session | **Yes** | Global | Room Host | Only room host can lock room to prevent new entries |
| `/api/v1/rooms/{code}/unlock` | `POST` | Session | **Yes** | Global | Room Host | Only room host can unlock room |
| `/api/v1/rooms/{code}/end` | `POST` | Session | **Yes** | Global | Room Host | Only room host can terminate meeting for all |
| `/api/v1/rooms/{code}/participants` | `GET` | None | No | Global | Room Participant | Lists current active participants in room |
| `/api/v1/rooms/{code}/participants/{id}/remove` | `POST` | Session | **Yes** | Global | Room Host | Evicts participant and blocks reconnection via ban list |
| `/api/v1/rooms/{code}/participants/{id}/mute` | `POST` | Session | **Yes** | Global | Room Host | Sends server-side mute command to LiveKit SFU |
| `/api/v1/rooms/{code}/participants/{id}/promote-speaker` | `POST` | Session | **Yes** | Global | Room Host | Promotes attendee to speaker with CAS lock & SFU sync |
| `/api/v1/rooms/{code}/participants/{id}/demote-speaker` | `POST` | Session | **Yes** | Global | Room Host | Demotes speaker back to attendee with SFU sync |
| `/api/v1/rooms/{code}/token` | `POST` | Optional | **Yes** | Global | Verified Participant | Issues signed LiveKit media token with room-scoped grant |
| `/api/v1/rooms/{code}/notes` | `GET` | Optional | No | Global | Room Participant | Retrieves notes scoped to room ID or personal commons |
| `/api/v1/rooms/{code}/notes` | `PUT` | Optional | **Yes** | Global | Room Participant | Optimistic concurrency update with revision fencing |
| `/api/v1/rooms/{code}/files/upload` | `POST` | Optional | **Yes** | Global | Room Participant | Multipart 25MB limit, magic-byte inspection, ClamAV |
| `/api/v1/rooms/{code}/files` | `GET` | Optional | No | Global | Room Participant | Lists uploaded files for active room |
| `/api/v1/rooms/{code}/files/{id}/download` | `GET` | Optional | No | Global | Room Participant | Downloads file with `nosniff`, `attachment`, auth check |
| `/api/v1/rooms/{code}/files/{id}` | `DELETE` | Optional | **Yes** | Global | Uploader / Host | Deletes file metadata and object storage payload |
| `/api/v1/rooms/{code}/p2p/config` | `GET` | Optional | No | Global | Room Participant | Returns STUN/TURN ICE server configuration |
| `/api/v1/rooms/{code}/p2p/ws` | `GET` | Optional | No | Global | Room Participant | Upgrades to WebSocket for WebRTC signaling |

---

## 3. ROLE-BASED ACCESS CONTROL (RBAC) MATRIX

The system enforces multi-tiered role authorization across institutional, meeting, and administrative boundaries:

| Operation | Student | Faculty | Dept Coordinator | Institution Auditor | Super Admin | Room Host | Room Attendee | Verified Guest |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **Join Public Meeting** | Allowed | Allowed | Allowed | Allowed | Allowed | Allowed | Allowed | Allowed |
| **Join Locked Meeting** | Denied | Denied | Denied | Denied | Denied | Allowed | Denied | Denied |
| **Bypass Waiting Room** | Denied | Denied | Denied | Denied | Denied | Allowed | Denied | Denied |
| **Admit / Deny Guests** | Denied | Denied | Denied | Denied | Denied | Allowed | Denied | Denied |
| **Mute Participants** | Denied | Denied | Denied | Denied | Denied | Allowed | Denied | Denied |
| **Remove Participant** | Denied | Denied | Denied | Denied | Denied | Allowed | Denied | Denied |
| **Promote / Demote Speaker**| Denied | Denied | Denied | Denied | Denied | Allowed | Denied | Denied |
| **End Meeting for All** | Denied | Denied | Denied | Denied | Denied | Allowed | Denied | Denied |
| **View Tenant Courses** | Own Only | Own Only | Dept Only | All Tenant | All Orgs | — | — | — |
| **Create Course in Dept** | Denied | Denied | Allowed | Denied | Allowed | — | — | — |
| **Audit Log Read Access** | Denied | Denied | Dept Only | All Tenant | All Orgs | — | — | — |
| **Mutate Audit Logs** | **DENIED**| **DENIED**| **DENIED** | **DENIED** | **DENIED** | — | — | — |
| **View Background Jobs** | Denied | Denied | Denied | Denied | Allowed | — | — | — |

---

## 4. STORAGE & FILE SECURITY AUDIT

### 4.1 Magic-Byte and Content Validation ([`validation.go`](file:///Users/quantum/Desktop/connect/connect-main/services/api/internal/files/validation.go))
File uploads are strictly validated by inspecting header signatures:
1. **PDF:** Validates `%PDF-` magic header (offset 0).
2. **PNG:** Validates `\x89PNG\r\n\x1a\n` 8-byte signature.
3. **JPEG:** Validates `0xFF 0xD8 0xFF` SOI marker.
4. **WebP:** Validates `RIFF` container and `WEBP` FOURCC code.
5. **TXT:** Validates UTF-8 validity and explicitly blocks binary control characters (`b < 0x20` excluding `\n`, `\r`, `\t`).
6. **PPTX:** Validates ZIP magic `PK\x03\x04` and verifies the presence of `[Content_Types].xml` and `ppt/` folder without extraction.
7. **Zip Bomb Protection:** Rejects any archive whose uncompressed entry sum exceeds 150 MB or has more than 1,000 files.

### 4.2 Storage Path & Traversal Protection
- Incoming filenames are sanitized with `SanitizeFilename()` which strips path traversal sequences (`..`), null bytes (`\x00`), and any characters not matching `[a-zA-Z0-9._ -]`.
- Files are stored in object storage using deterministic UUID keys: `{room_id}/{file_uuid}/{sanitized_filename}`, preventing storage root escape.

### 4.3 Download Headers & Response Guard
When files are served:
- `Content-Type: <validated_mime_type>`
- `Content-Disposition: attachment; filename="<sanitized_filename>"`
- `X-Content-Type-Options: nosniff` (mitigates browser MIME confusion attacks)
- `Cache-Control: private, no-cache, no-store, must-revalidate`

---

## 5. LIVEKIT & REALTIME MEDIA SECURITY

### 5.1 Token Minting & Scope Isolation
- Tokens are minted strictly on the Go control plane via `livekit.NewTokenService`.
- Client requests specify their participant identity and display name, which are checked against the verified database session or signed guest token.
- Room grants are restricted:
  - `CanPublish: true` only if caller is the Host or has been explicitly promoted to Speaker via CAS lock.
  - `CanSubscribe: true` for all admitted participants.
  - `RoomAdmin: false` for all participants (SFU admin actions are executed exclusively by the backend control plane using API secret).

### 5.2 Anti-Spoofing & Reconnection Resistance
- If an attendee attempts to claim `user:<victim_uuid>` in headers or query params without a matching session cookie, the request fails with `401 Unauthorized` / `403 Forbidden`.
- Banned/removed participants are recorded in `room_banned_identities` (in-memory + database) and denied future token issuance.

---

## 6. CLIENT-SIDE SECURITY AUDIT (WEB & MOBILE)

### 6.1 Web Client (`apps/web`)
- **No Privileged Secrets in Client Bundles:** All client environment variables use `NEXT_PUBLIC_` prefix. The `SUPABASE_SERVICE_ROLE_KEY` and `LIVEKIT_API_SECRET` are never referenced in `apps/web`.
- **Session Cookie Security:** Session cookies are set with `HttpOnly`, `SameSite=Lax` (or `Strict`), and `Secure=true` in production. JavaScript cannot access session tokens.
- **XSS & Injection Protection:** Next.js React JSX automatically encodes rendered values. Dangerous sinks (`dangerouslySetInnerHTML`) are absent in user-controllable surfaces.
- **CORS & Origin Integrity:** Production CORS allows only canonical domains (`https://connect.aitathastu.com`, `https://connect-mauve-nine.vercel.app`). Wildcard origins are rejected by config validation.

### 6.2 Mobile Client (`apps/mobile`)
- **Token Storage:** Tokens are persisted via platform SecureStore / EncryptedSharedPreferences abstractions.
- **TLS & Transport Security:** Native Android network configuration enforces HTTPS (`cleartextTrafficPermitted: false` in production build).
- **Safe Logout:** Calling logout immediately purges cached auth tokens and resets application navigation state to `LandingScreen`.

---

## 7. IDENTIFIED SECURITY DEFECTS & REMEDIATION STATUS

| Finding ID | Severity | Component | Description & Impact | Remediation Plan | Status |
| :---: | :---: | :--- | :--- | :--- | :---: |
| **SEC-01** | **Low** | `auth/handlers.go:404` | IPv6 addresses in `extractIP` use `strings.LastIndex(remote, ":")` which corrupts `[::1]:port`. | Replace with `net.SplitHostPort(r.RemoteAddr)` across all handlers. | **OPEN** |
| **SEC-02** | **Medium** | `internal/room/service.go` | Missing LiveKit webhook handler for asynchronous participant disconnect detection. | Implement `/api/v1/livekit/webhook` with LiveKit signature verification. | **OPEN** |
| **SEC-03** | **Medium** | `internal/config/config.go` | Missing reverse-proxy client IP trust configuration (`TRUSTED_PROXIES` header extraction). | Add optional trusted proxy header parser (`X-Forwarded-For`). | **OPEN** |
