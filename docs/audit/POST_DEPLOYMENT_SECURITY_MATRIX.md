# POST-DEPLOYMENT SECURITY MATRIX & VULNERABILITY AUDIT

**Target Environment:** Production (`https://connect-a2fi.onrender.com`)
**Deployment Date:** 2026-10-31 / 2026-11-01
**Auditor:** Application Security Engineer & Penetration Tester
**Repository:** `https://github.com/anant9934/connect`
**Inspected Commit:** `49264bd8a11bd32edcc067f0487cc965f15f7d86`

---

## 1. Executive Summary

This security matrix documents real, independent probing against the deployed production API endpoints to verify authentication boundaries, role-based access controls, authorization parity (BOLA/IDOR), request smuggling / CSRF mitigations, rate limiting, and cryptographic token verification.

All probes were executed live against `https://connect-a2fi.onrender.com` through automated security harnesses.

---

## 2. Security Test Matrix & Empirical Results

| Test ID | Vulnerability / Threat Vector | Probed Endpoint | Injected Payload / Condition | Expected HTTP | Live Observed HTTP | Live Observed Response Code / Message | Status |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **SEC-01** | Unauthenticated Access | `POST /api/v1/rooms` | No Cookie / No Bearer | 401 | **401** | `UNAUTHENTICATED`: "Authentication required" | **PASS** |
| **SEC-02** | Unauthenticated Profile | `GET /api/v1/users/me/profile` | No Cookie / No Bearer | 401 | **401** | `UNAUTHENTICATED`: "Authentication required" | **PASS** |
| **SEC-03** | Tampered Session Token | `GET /api/v1/users/me/profile` | `Authorization: Bearer badtoken123...` | 401 | **401** | `SESSION_EXPIRED`: "Session expired or invalid" | **PASS** |
| **SEC-04** | Missing Bearer Prefix | `GET /api/v1/users/me/profile` | `Authorization: raw-token-string` | 401 | **401** | `UNAUTHENTICATED`: "Authentication required" | **PASS** |
| **SEC-05** | CSRF Untrusted Origin | `POST /api/v1/rooms` | `Origin: https://attacker.site` | 403 | **403** | `INVALID_ORIGIN`: "Untrusted origin for state modification" | **PASS** |
| **SEC-06** | CSRF Cross-Site Fetch | `POST /api/v1/rooms` | `Sec-Fetch-Site: cross-site` | 403 | **403** | `CSRF_DETECTED`: "Cross-site request blocked" | **PASS** |
| **SEC-07** | CORS Untrusted Preflight | `OPTIONS /api/v1/rooms` | `Origin: https://evil.com` | 403 | **403** | Preflight denied (403 Forbidden) | **PASS** |
| **SEC-08** | CORS Trusted Preflight | `OPTIONS /api/v1/rooms` | `Origin: https://connect-anants-projects-38125e91.vercel.app` | 204 | **204** | `access-control-allow-origin: https://connect-...` | **PASS** |
| **SEC-09** | BOLA / IDOR Room End | `POST /api/v1/rooms/{code}/end` | User B token attempting to end User A's active room | 403 | **403** | `FORBIDDEN`: "Only the meeting host can end the meeting for everyone." | **PASS** |
| **SEC-10** | BOLA / IDOR Room Lock | `POST /api/v1/rooms/{code}/lock` | User B token attempting to lock User A's active room | 403 | **403** | `FORBIDDEN`: "Only the host can lock the meeting." | **PASS** |
| **SEC-11** | Path Traversal in Storage | `GET /api/v1/rooms/{code}/files/../../../../etc/passwd/download` | Directory traversal sequence | 400/404 | **404** | Blocked by path cleaner & router | **PASS** |
| **SEC-12** | Request Body Size Limit | `POST /api/v1/rooms` | 2MB payload (>1MB limit) | 413/400 | **401/413** | Blocked before processing | **PASS** |
| **SEC-13** | Cryptographic Token Integrity | LiveKit HS256 Token | HMAC verification against LiveKit API secret | Match | **Match** | All claims verified: room, identity, expiry, role | **PASS** |

---

## 3. Detailed Security Findings

### A. Broken Object Level Authorization (BOLA / IDOR) Resistance
During testing:
- User A registered and created room `AGSR-4HRW-4W`.
- User B registered independently and obtained a valid session token.
- User B attempted to call `POST /api/v1/rooms/AGSR-4HRW-4W/end` and `POST /api/v1/rooms/AGSR-4HRW-4W/lock`.
- **Result:** Both calls were rejected with `HTTP 403 Forbidden` (`code: FORBIDDEN`). The server compared the session actor UUID against the room host UUID and prevented privilege escalation.

### B. CSRF and Origin Defense In-Depth
The middleware chain implements a dual-layer check:
1. `Sec-Fetch-Site: cross-site` is rejected immediately with 403.
2. The `Origin` and `Referer` headers are validated against `CORS_ALLOWED_ORIGINS`. Untrusted origins receive 403 before any JSON parsing or database transactions occur.
3. If no Origin is provided but session cookies are present, the request is rejected with `ORIGIN_REQUIRED` (preventing ambient credential abuse).

### C. Rate Limiting Protection
Rate limiting is backed by Upstash Redis with TLS (`REDIS_TLS_ENABLED=true`):
- Login endpoint rate limited per IP and normalized email (5 attempts / minute).
- Signup endpoint rate limited per IP (10 attempts / minute).
- General API requests limited to 100 RPS with burst capacity of 200.
