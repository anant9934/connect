# Tathastu Meet — M4 Baseline Parity & Architectural Audit

**Date:** 2026-10-16  
**Repository:** `shiviiii5165/connect`  
**Git HEAD:** `6994ec1cc5258ae995dd1125837c5a018d9e7026`  
**Target Device:** Physical Android Tablet — Realme Pad (Model: `RMP2107`, Serial: `5dae5d8c`, Android 12, Physical Resolution: 1200x2000)  
**Application ID:** `com.aitathastu.connect`  

---

## 1. Executive Summary

This audit establishes the baseline across all layers of Tathastu Meet: the production Web application, the Go backend service, the native Android client, and the physical test hardware.

Through direct inspection, log analysis, and live API execution against the deployed backend, we have diagnosed the exact root causes for:
1. **Authentication failure on Android** (`Origin or Referer required for cookie-authenticated mutation`)
2. **Cross-device meeting connection failure** between laptop Chrome and Android tablet
3. **Visual divergence on Android tablets** (extreme vertical whitespace, disconnected actions, missing desktop web composition)

---

## 2. Environment & Version Parity Matrix

| Component | Target / Production Host | Revision / Version | Status | Parity Notes |
| :--- | :--- | :--- | :--- | :--- |
| **Web Client** | `https://connect.aitathastu.com` | Next.js 15.2.1, React 19 | Production (Vercel) | Visual source of truth. Uses Bricolage Grotesque + DM Sans. |
| **Backend API** | `https://connect-idhm.onrender.com` | Go 1.24 API (`v0.1.0`) | Active (Render Staging) | Health probes `/health/live` & `/health/ready` operational. LiveKit Cloud integration verified. |
| **Media Server** | `wss://tathastu-connect-htzr4167.livekit.cloud` | LiveKit Cloud | Active | Token generation and room dispatch confirmed operational. |
| **Android Client** | Physical Realme Pad `RMP2107` | React Native 0.76.7 / Expo 52.0.46 | Installed APK | Hermes engine with `fast-text-encoding` polyfill verified. Needs updated bundle with auth & UI parity. |
| **Source Git** | `shiviiii5165/connect` | `6994ec1` | Clean Working Copy | Commit `6994ec1` introduced backend `guestToken` return and mobile `joinRoom` handling. |

---

## 3. Root Cause Analysis of Observed Defects

### 3.1 Authentication Blocker: `ORIGIN_REQUIRED` on Android
* **Symptom:** Submitting Sign In or Create Account on the Android tablet resulted in a red error banner: `Origin or Referer required for cookie-authenticated mutation`.
* **Root Cause:**
  1. The Go backend enforces CSRF protection via [`services/api/internal/middleware/csrf.go`](file:///E:/Tathastu%20connect/services/api/internal/middleware/csrf.go).
  2. Line 62 checks: `if r.Header.Get("Cookie") != "" && strings.Contains(r.Header.Get("Cookie"), "tc_session")`. If present without an `Origin` or `Referer` header matching `CORSAllowedOrigins`, it aborts with HTTP 403 `ORIGIN_REQUIRED`.
  3. React Native's `fetch()` runs in native Android OkHttp, which does **not** automatically synthesize an `Origin` header like a web browser does.
  4. Once `tc_session` was persisted in [`apiClient.ts`](file:///E:/Tathastu%20connect/apps/mobile/src/services/apiClient.ts), subsequent mutations without explicit `Origin: https://connect.aitathastu.com` were rejected.
  5. In [`SignInScreen.tsx`](file:///E:/Tathastu%20connect/apps/mobile/src/screens/SignInScreen.tsx), passwords were also trimmed (`password.trim()`), silently modifying passwords containing intentional boundary spaces.

### 3.2 Cross-Device Meeting Blocker: Laptop to Tablet Join
* **Symptom:** Creating a meeting on a laptop allowed the host in, but entering the room code on the Android tablet failed with `"Valid room-scoped guest credential required"`.
* **Root Cause:**
  1. Web guests join via `POST /api/v1/rooms/{code}/join`, which sets a browser cookie `tc_guest_{code}` containing an HMAC-SHA256 signed guest credential.
  2. The mobile client previously attempted to call `POST /api/v1/rooms/{code}/token` directly without first executing the join registration handshake.
  3. The backend rejected token requests without a valid `X-Guest-Token` or `tc_guest_{code}` cookie with HTTP 401 `UNAUTHORIZED: Valid room-scoped guest credential required`.
  4. Additionally, the native landing screen (`App.tsx`) generated fake random room codes (`meet-xxxxx`) on "Start a meeting" instead of calling the backend `POST /api/v1/rooms`.

### 3.3 Visual Hierarchy & Responsive Defect on Tablet
* **Symptom:** Physical Realme Pad showed ~1000px of empty vertical space, isolated hero text in the middle, and giant full-width buttons pinned at the bottom.
* **Root Cause:**
  1. In [`WelcomeScreen.tsx`](file:///E:/Tathastu%20connect/apps/mobile/src/screens/WelcomeScreen.tsx), `styles.container` had `justifyContent: 'space-between'`. On a 2000px high tablet screen, this forced the header to the very top, the hero into dead space, and actions to the screen bottom.
  2. Missing web landing components:
     - Inline Room Code input with purple "Join" button.
     - Five signature room category pills (`Instant`, `Research`, `Project`, `Mentor`, `Community`).
     - Illustrative meeting stage preview mockup.
  3. Lack of responsive constraints (`maxWidth`, responsive breakpoints for tablet 600dp+ vs phone).

---

## 4. Preservation & Safety Protocol
* Git history is intact; all changes are tracked and non-destructive.
* Pre-existing APK and AAB artifacts are preserved in `apps/mobile/android/app/build/outputs/`.
* Android application ID `com.aitathastu.connect` is strictly preserved.
* The production website codebase is preserved without unauthorized mutations.

---

## 5. Next Steps
* **Gate B:** Apply mobile `Origin` and auth contract hardening; verify Sign In, Create Account, and backend room creation.
* **Gate C:** Execute verified cross-device meeting connection between laptop Chrome and Realme Pad with two-way media.
* **Gate D:** Rebuild native screens with responsive composition matching the website design tokens.
