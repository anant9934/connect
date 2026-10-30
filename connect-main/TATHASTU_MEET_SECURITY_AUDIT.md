# TATHASTU MEET — APPLICATION & INFRASTRUCTURE SECURITY AUDIT

**Product:** Tathastu Meet  
**Website:** `https://connect.aitathastu.com/`  
**Application ID:** `com.aitathastu.connect`  
**Date:** October 18, 2026  
**Auditor:** Joint Application & WebRTC Security Architecture Team  

---

## 1. Executive Summary

This comprehensive security audit evaluates the full application surface of Tathastu Meet, encompassing the Next.js frontend, Go backend microservices, LiveKit Cloud SFU WebRTC pipeline, and browser client boundaries.

Each finding is classified according to standard industry severity: **Critical**, **High**, **Medium**, **Low**, or **Informational**.

Zero live secrets, credentials, or private participant records are printed in this report.

---

## 2. Security Findings Matrix

| Finding ID | Classification | Component | Status | Summary |
| :---: | :---: | :---: | :---: | :--- |
| **SEC-01** | **Medium** | Next.js Config | **RESOLVED** | Missing HTTP Strict-Transport-Security (HSTS) on production responses. |
| **SEC-02** | **Medium** | Private Routes | **RESOLVED** | Unauthenticated meeting URLs (`/room/*`, `/history/*`) lacked strict `X-Robots-Tag: noindex` and private `Cache-Control` response headers. |
| **SEC-03** | **Low** | Next.js Config | **RESOLVED** | Production browser source maps setting was undeclared in `next.config.mjs`. Explicitly pinned to `false`. |
| **SEC-04** | **Informational** | Next.js Hydration | **VERIFIED NON-VULNERABILITY** | Dynamic room code visible in serialized React hydration payloads (`self.__next_f.push`). |
| **SEC-05** | **Informational** | LiveKit Token Issuance | **VERIFIED SECURE** | Server-side signing secret isolation with short-lived (10m) least-privilege WebRTC grants. |
| **SEC-06** | **Informational** | Guest Authentication | **VERIFIED SECURE** | HMAC cryptographic verification on unauthenticated guest credentials prevents identity spoofing. |

---

## 3. Deep-Dive Security Evaluations

### 3.1 SEC-01: HTTP Strict-Transport-Security (HSTS) Hardening
- **Severity:** Medium (Pre-remediation) $\to$ **Resolved**
- **Vulnerability Description:** Previously, `next.config.mjs` defined Content-Security-Policy and X-Frame-Options, but omitted the `Strict-Transport-Security` header. While cloud reverse proxies (e.g., Cloudflare/Render) may enforce TLS, relying exclusively on edge proxies introduces configuration drift risk.
- **Remediation Implemented:**
  In `apps/web/next.config.mjs`, added:
  ```http
  Strict-Transport-Security: max-age=63072000; includeSubDomains; preload
  ```
- **Verification:** Verified via automated regression suite `test/seo_and_security_hardening.test.mjs`.

---

### 3.2 SEC-02: Private Route Isolation & Cache Protection
- **Severity:** Medium (Pre-remediation) $\to$ **Resolved**
- **Vulnerability Description:** When users navigate to `/room/[code]` or `/history`, shared proxy caches or search crawlers could theoretically cache or index sensitive meeting URLs if shared on public chat platforms.
- **Remediation Implemented:**
  1. Configured dedicated response headers in `next.config.mjs`:
     ```http
     X-Robots-Tag: noindex, nofollow, noarchive, nosnippet
     Cache-Control: private, no-cache, no-store, max-age=0, must-revalidate
     Pragma: no-cache
     ```
  2. Created `apps/web/app/room/layout.tsx` and `apps/web/app/history/layout.tsx` exporting:
     ```ts
     export const metadata: Metadata = {
       robots: {
         index: false,
         follow: false,
         nocache: true,
         googleBot: { index: false, follow: false, noimageindex: true },
       },
     };
     ```
  3. Explicitly excluded `/room/`, `/room/*`, `/history`, and `/history/*` in `app/robots.ts` and `app/sitemap.ts`.

---

### 3.3 SEC-03: Production Source Map Exposure Prevention
- **Severity:** Low (Pre-remediation) $\to$ **Resolved**
- **Remediation Implemented:** Added `productionBrowserSourceMaps: false` to `next.config.mjs`. Verified that zero `.map` files are generated or placed in `.next/static`.

---

### 3.4 SEC-04: React Hydration Payload Serialization Audit
- **Severity:** Informational (Verified Safe)
- **Observation:** In Chrome DevTools, users observed serialized parameters containing the active room code within Next.js hydration scripts (`self.__next_f.push([1,"..."])`).
- **Audit Result:**
  In Next.js App Router, dynamic route parameters (e.g., `/room/[code]`) must be passed from the server render pass to the client runtime so that client hooks (`useParams()`, `usePathname()`) can resolve route state.
  Possession of a room code does **not** grant unauthorized access:
  - **Waiting Room Enforcement:** When waiting room is enabled, attendees enter an isolated state where `getRoomToken` returns `ADMISSION_REQUIRED`. The Go backend will not sign a LiveKit media grant until the host explicitly calls `POST /api/v1/rooms/:code/admit`.
  - **Host Privilege Protection:** Host privileges (`isHost: true`, `CanPublishData: true`, `RoomCreate: true`) are verified exclusively server-side by checking if `user.ID == room.CreatedBy`. A guest client cannot escalate to host by modifying route parameters or local state.
  - **HMAC Guest Verification:** Unauthenticated guest attendees are issued cryptographically signed HMAC guest tokens (`VerifyGuestToken`), preventing identity spoofing.

---

### 3.5 SEC-05: LiveKit WebRTC Token Grant Flow
- **Severity:** Informational (Verified Best Practice)
- **Architecture Review:**
  1. **Secret Storage:** `LIVEKIT_API_SECRET` and `LIVEKIT_API_KEY` are stored strictly as private server environment variables. Neither value is prefixed with `NEXT_PUBLIC_` and neither is bundled into client JavaScript.
  2. **Grant Scoping:** In `services/api/internal/livekit/token.go`:
     - Tokens are valid for only `10 * time.Minute`.
     - `RoomAdmin` is hardcoded to `false` (administrative room control remains solely on the Go API).
     - `RoomRecord` is hardcoded to `false`.
     - Tokens are locked to `Room: params.RoomCode` and cannot be replayed in other rooms.

---

### 3.6 SEC-06: Production Security Headers Matrix

The full production HTTP response headers for `https://connect.aitathastu.com/` are verified as follows:

```http
Strict-Transport-Security: max-age=63072000; includeSubDomains; preload
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
X-DNS-Prefetch-Control: on
Referrer-Policy: strict-origin-when-cross-origin
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Resource-Policy: same-origin
Permissions-Policy: camera=(), microphone=(), display-capture=(), geolocation=(), payment=()
Content-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data: blob: https:; connect-src 'self' http://localhost:8080 ws://localhost:8080 http://localhost:7880 ws://localhost:7880 wss://localhost:7880 https: wss:; frame-ancestors 'none'; object-src 'none'; base-uri 'self';
```

For `/room/:path*`:
```http
Permissions-Policy: camera=(self), microphone=(self), display-capture=(self), geolocation=(), payment=()
X-Robots-Tag: noindex, nofollow, noarchive, nosnippet
Cache-Control: private, no-cache, no-store, max-age=0, must-revalidate
Pragma: no-cache
```
