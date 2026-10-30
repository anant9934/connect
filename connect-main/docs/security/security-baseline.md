# Tathastu Connect - Application Security Baseline (OWASP ASVS 5.0)

## 1. Overview

This document defines the application security verification standard for **Tathastu Connect**, mapped directly against the **OWASP Application Security Verification Standard (ASVS) 5.0 Level 2/3** requirements.

Security is treated as a fundamental architectural pillar, not an afterthought.

---

## 2. Implemented Controls Mapping (Phase 1)

| ASVS Area | Control ID | Requirement Description | Implementation in Tathastu Connect | Status |
|:---|:---|:---|:---|:---|
| **V1: Architecture** | 1.1.1 | Clear separation of trust boundaries | Go API, Web Frontend, SFU Plane, and AI Tathastu Federation Boundary strictly isolated. | **Implemented** |
| | 1.1.2 | Fail-closed defaults | Missing production config halts startup. Protected operations reject unauthorized requests by default. | **Implemented** |
| | 1.1.3 | Media plane decoupled from control plane | LiveKit WebRTC traffic never passes through the application API gateway. | **Implemented** |
| **V5: Validation & Sanitization** | 5.1.1 | Strict HTTP method enforcement | Handlers explicitly check and reject non-allowed HTTP verbs (`MethodNotAllowed`). | **Implemented** |
| | 5.1.2 | Request payload size restrictions | `http.MaxBytesReader` restricts all incoming payloads to 1MB. Over-sized requests rejected with 413. | **Implemented** |
| | 5.1.3 | Anti-Mass-Assignment & strict JSON parsing | `json.Decoder.DisallowUnknownFields()` actively rejects unmapped/malicious attributes. | **Implemented** |
| | 5.1.4 | Content-Type validation | `RequireJSONContentType` enforces `application/json` on state-modifying requests. | **Implemented** |
| | 5.3.4 | Parameterized database queries | PostgreSQL queries strictly use parameterized arguments via `pgxpool`. Zero string concatenation. | **Implemented** |
| **V7: Error Handling & Logging** | 7.1.1 | No leakage of sensitive data in errors | Client errors use sanitized JSON structures (`model.ErrorResponse`). Zero stack traces or internal IPs leaked. | **Implemented** |
| | 7.1.2 | Dependency failure isolation | `/health/ready` logs internal diagnostic errors to server `slog` but returns generic `degraded` to caller. | **Implemented** |
| | 7.2.1 | Structured audit logging | Go standard library `slog` produces JSON structured logs with correlation IDs (`X-Request-ID`). | **Implemented** |
| | 7.2.2 | Credential redaction in logs | Sensitive headers (`Authorization`, `Cookie`, `Set-Cookie`), passwords, and tokens are never logged. | **Implemented** |
| **V13: API & Web Services** | 13.1.1 | Strict CORS policy | Allowlist-only CORS validation. Zero reflection of arbitrary `Origin`. Wildcards forbidden in production. | **Implemented** |
| | 13.1.2 | Versioned API architecture | All application business endpoints isolated under `/api/v1/`. | **Implemented** |
| | 13.2.1 | Distributed rate limiting | Interface `ratelimit.Limiter` with atomic Redis sliding window. Memory limiter blocked in production. | **Implemented** |
| **V14: Configuration & Headers** | 14.1.1 | Anti-MIME sniffing | `X-Content-Type-Options: nosniff` header applied to all responses. | **Implemented** |
| | 14.1.2 | Anti-Clickjacking | `X-Frame-Options: DENY` and CSP `frame-ancestors 'none'`. | **Implemented** |
| | 14.1.3 | Referrer leak defense | `Referrer-Policy: strict-origin-when-cross-origin`. | **Implemented** |
| | 14.1.4 | Hardware permission isolation | `Permissions-Policy` restricts camera, microphone, and geolocation on landing/API surfaces. | **Implemented** |
| | 14.1.5 | Transport security | `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload` in production HTTPS. | **Implemented** |
| | 14.1.6 | Server banner stripping | Removal of `X-Powered-By` and `Server` headers. | **Implemented** |
| | 14.2.1 | Secret hygiene | Zero secrets committed. `.env` and sensitive patterns ignored in `.gitignore`. Production fails closed. | **Implemented** |

---

## 3. Session & Authentication Principles (Phase 2 Roadmap)

1. **Tokens in Browser Storage**: `localStorage` and `sessionStorage` are strictly forbidden for session tokens.
2. **Cookie Architecture**:
   - `__Host-` cookie prefix mandatory in production.
   - Flags: `HttpOnly`, `Secure`, `SameSite=Strict` or `Lax`.
3. **Session Rotation**: Session identifier rotated immediately following privilege changes / login.
4. **Revocation**: Server-side session blacklist/invalidation via Redis with active TTL.
