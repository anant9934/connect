# Tathastu Meet — M4 Authentication & Room Integration Architecture

**Date:** 2026-10-16  
**Backend Host:** `https://connect-idhm.onrender.com` (Go API `v0.1.0`)  
**Media Server:** `wss://tathastu-connect-htzr4167.livekit.cloud`  
**Mobile Package:** `com.aitathastu.connect`  

---

## 1. Authentication Handshake & Root Cause Resolution

### 1.1 The CSRF & `ORIGIN_REQUIRED` Defect
In [`services/api/internal/middleware/csrf.go`](file:///E:/Tathastu%20connect/services/api/internal/middleware/csrf.go):
```go
// If neither Origin nor Referer is present, allow only if no session cookie was included
// (e.g. non-browser API test clients using pure Authorization header)
if r.Header.Get("Cookie") != "" && strings.Contains(r.Header.Get("Cookie"), "tc_session") {
    model.SendJSONError(w, r, http.StatusForbidden, "ORIGIN_REQUIRED", "Origin or Referer required for cookie-authenticated mutation")
    return
}
```
* **Failure Mechanism:** React Native's `fetch()` runs atop Android OkHttp without browser-origin synthesis. Once any request persisted `tc_session` in memory or the native cookie store, all subsequent state-mutating POST requests (including Sign Up, Room Creation, or Lock/Unlock) lacked an `Origin` header and were immediately rejected with HTTP 403 `ORIGIN_REQUIRED`.
* **Fix Implemented:** In [`apps/mobile/src/services/apiClient.ts`](file:///E:/Tathastu%20connect/apps/mobile/src/services/apiClient.ts), all outgoing requests now explicitly declare:
  - `Origin: https://connect.aitathastu.com`
  - `Referer: https://connect.aitathastu.com/`
  - `Accept: application/json`
  - `Content-Type: application/json`
* **Logout & Token Invalidation:** When `apiClient.logout()` is invoked, both `authToken` and all cached cookies (`sessionCookies` and `guestTokens`) are systematically purged to prevent state leakage between user sessions.

### 1.2 Password Preservation & Validation
* **Defect:** [`SignInScreen.tsx`](file:///E:/Tathastu%20connect/apps/mobile/src/screens/SignInScreen.tsx) previously executed `password.trim()`. Passwords with leading or trailing whitespace characters were corrupted before hashing.
* **Fix:** The raw password entered by the user is preserved unchanged. Added client-side minimum length enforcement (8 characters) for registration.

---

## 2. Complete Room Lifecycle & Cross-Device Protocol

### 2.1 The Two Participant Personas
1. **Authenticated Host:**
   - Registers via `POST /api/v1/auth/signup` or logs in via `POST /api/v1/auth/login`.
   - Obtains a 64-character hex session token (`tc_session`).
   - Creates a persistent meeting room via `POST /api/v1/rooms` with `Authorization: Bearer <token>`.
   - Receives the canonical room `publicCode` (formatted as `XXXX-YYYY-ZZ`) and `inviteUrl`.
   - Joins room directly with host privileges.

2. **Guest Participant (Cross-Device join from Laptop or Android):**
   - Enters room code or pastes deep link (`https://connect.aitathastu.com/room/:code`).
   - Normalizes room code: strips spaces/hyphens, capitalizes, formats to canonical 10-char representation.
   - Handshake Step 1: Calls `POST /api/v1/rooms/{code}/join` with `displayName`.
   - The Go server issues an HMAC-SHA256 verified guest credential:
     `gst.<base64(guestIdentity)>.<roomCode>.<expiryTimestamp>.<hmacSignature>`
   - The guest credential is returned both in the JSON payload (`guestToken`) and in the `Set-Cookie` header (`tc_guest_{code}`).
   - Handshake Step 2: Calls `POST /api/v1/rooms/{code}/token` transmitting the guest credential via `X-Guest-Token: <guestToken>` and `guestToken` body field.
   - The Go backend verifies the HMAC signature and expiration, ensuring the guest cannot tamper with identity or join unauthorized rooms.
   - Upon verification, the backend issues an authorized LiveKit JWT signed with `LIVEKIT_API_SECRET`.

---

## 3. End-to-End Live API Verification Evidence

The following test was executed directly against `https://connect-idhm.onrender.com`:

```text
=== Step 1: User Registration ===
POST /api/v1/auth/signup -> HTTP 201 Created
User ID: bf41997a-4b0f-47a2-842e-a1ab896dec28
Session Token: aaa3423fd22dc3933feb5d19d3087d6be675a9a2fc5a9b05de8beba634234be7

=== Step 2: Authenticated Room Creation ===
POST /api/v1/rooms -> HTTP 201 Created
Public Room Code: A2A6-0N01-00
Invite URL: https://connect.aitathastu.com/room/A2A6-0N01-00

=== Step 3: Cross-Device Guest Join Handshake ===
POST /api/v1/rooms/A2A6-0N01-00/join -> HTTP 200 OK
Guest Token: gst.Z3Vlc3Q6MmI1NDgyYzQtMjMwMi00YzczLWEwNjAtYzM5ZjIzOWVlNzNh.A2A6-0N01-00.1792210895.fa2ea03b0f46...
Guest Identity: guest:2b5482c4-2302-4c73-a060-c39f239ee73a

=== Step 4: LiveKit Media Token Generation ===
POST /api/v1/rooms/A2A6-0N01-00/token (with X-Guest-Token) -> HTTP 200 OK
LiveKit URL: wss://tathastu-connect-htzr4167.livekit.cloud
LiveKit JWT: eyJhbGciOiJIUzI1NiIs... (verified HS256 grant)
```

All 4 phases of the meeting lifecycle are active and verified.
