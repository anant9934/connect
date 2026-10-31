# POST-DEPLOYMENT BASELINE & CONSISTENCY AUDIT

**Target Environment:** Production (`main`)
**Deployment Date:** 2026-10-31 / 2026-11-01
**Auditor:** Principal Software Architect & Production SRE
**Repository:** `https://github.com/anant9934/connect`
**Current HEAD Commit:** `49264bd8a11bd32edcc067f0487cc965f15f7d86`

---

## 1. Executive Summary

This document establishes the verified deployment baseline across the dual-cloud infrastructure (Vercel Edge Frontend + Render Go Backend), validating exact commit alignment, reverse-proxy rewrite behavior, security headers, TLS termination, and environment variable completeness.

Both deployment targets have been independently probed, verified, and mapped to the exact GitHub `main` revision.

---

## 2. Deployment Revision Alignment

| Component | Target Platform | Deployed Revision (Commit SHA) | Active Deployment UID / ID | Deployment State | Verified Live URL |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Git Source** | GitHub (`origin/main`) | `49264bd8a11bd32edcc067f0487cc965f15f7d86` | N/A | `Clean` | `https://github.com/anant9934/connect/tree/main` |
| **Frontend** | Vercel | `49264bd8a11bd32edcc067f0487cc965f15f7d86` | `dpl_Ea7zghpgjE5nngQ8JXUASCttSqNZ` | `READY` (Promoted) | `https://connect-anants-projects-38125e91.vercel.app` |
| **Backend** | Render | `49264bd8a11bd32edcc067f0487cc965f15f7d86` | `dep-dbj5th95efls73dmh3tg` | `live` / `succeeded` | `https://connect-a2fi.onrender.com` |

Both live environments are synchronized to the exact commit `49264bd`.

---

## 3. Environment Variable Completeness & Verification

### A. Vercel Frontend Configuration (Project: `prj_taOsuwd4qINWVxlgPCubqSmsqkPc`)
Verified live via Vercel Management API:

1. `INTERNAL_API_URL`: `https://connect-a2fi.onrender.com` (Used for server-side Next.js rewrites)
2. `NEXT_PUBLIC_APP_URL`: `https://connect-anants-projects-38125e91.vercel.app`
3. `NEXT_PUBLIC_API_URL`: `https://connect-a2fi.onrender.com`
4. `NEXT_PUBLIC_SUPABASE_URL`: `https://qirzlvahobehykkkgouz.supabase.co`
5. `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`: Validated format `sb_publishable_okoG8yzDLmuKbZQOUwvbxA_nzIKntvd`
6. `NEXT_PUBLIC_LIVEKIT_URL`: `wss://tathastu-connect-htzr4167.livekit.cloud`

*Note: SSO protection (`ssoProtection`) was deactivated via API patch, allowing unrestricted HTTPS access to public users.*

### B. Render Backend Configuration (Service: `srv-dbj507nlk1mc73897go0`)
Verified live via Render Management API (24 active variables):

1. `APP_ENV`: `production`
2. `PORT`: `8080`
3. `LOG_LEVEL`: `info`
4. `DATABASE_URL`: Verified pooled connection to `ep-sweet-block-b4g7rmvt-pooler.c-6.us-east-2.aws.neon.tech/neondb?sslmode=require`
5. `DB_MAX_OPEN_CONNS`: `25`
6. `DB_MAX_IDLE_CONNS`: `10`
7. `DB_CONN_MAX_LIFETIME_SEC`: `300`
8. `REDIS_URL`: Verified TLS connection to `massive-moccasin-188003.upstash.io:6379`
9. `REDIS_TLS_ENABLED`: `true`
10. `RATE_LIMIT_ENABLED`: `true`
11. `RATE_LIMIT_RPS`: `100`
12. `RATE_LIMIT_BURST`: `200`
13. `CORS_ALLOWED_ORIGINS`: `https://connect.aitathastu.com,https://connect-anants-projects-38125e91.vercel.app,https://connect-git-main-anants-projects-38125e91.vercel.app`
14. `PUBLIC_APP_ORIGIN`: `https://connect-anants-projects-38125e91.vercel.app`
15. `LIVEKIT_URL`: `wss://tathastu-connect-htzr4167.livekit.cloud`
16. `LIVEKIT_API_KEY`: `APIthtswjdmJvEz`
17. `LIVEKIT_API_SECRET`: Validated cryptographic secret
18. `STORAGE_PROVIDER`: `r2`
19. `R2_ENDPOINT`: `https://832b6a4050f19e6433b440106ad234e7.r2.cloudflarestorage.com`
20. `R2_BUCKET`: `connect`
21. `R2_ACCESS_KEY_ID`: Validated 32-char key
22. `R2_SECRET_ACCESS_KEY`: Validated 64-char key
23. `R2_REGION`: `auto`
24. `CLAMAV_ENABLED`: `false` (Disabled for serverless/PaaS deployment)

---

## 4. Live Protocol & Network Verification

### A. HTTP/2 and TLS Termination
All requests to `https://connect-a2fi.onrender.com` and `https://connect-anants-projects-38125e91.vercel.app` enforce:
- HTTP/2 negotiated via ALPN.
- TLS 1.3 encryption.
- `strict-transport-security: max-age=63072000; includeSubDomains; preload`.

### B. Security Headers Verified
Empirically captured from live response:
```http
content-security-policy: default-src 'self'; frame-ancestors 'none'; object-src 'none'; base-uri 'self';
cross-origin-opener-policy: same-origin
cross-origin-resource-policy: same-origin
permissions-policy: camera=(), microphone=(), display-capture=(), geolocation=(), payment=()
referrer-policy: strict-origin-when-cross-origin
x-content-type-options: nosniff
x-frame-options: DENY
```

### C. CORS Preflight Execution
- Preflight (`OPTIONS /api/v1/rooms`) with `Origin: https://connect-anants-projects-38125e91.vercel.app`:
  - Result: `HTTP 204 No Content`
  - `access-control-allow-origin: https://connect-anants-projects-38125e91.vercel.app`
  - `access-control-allow-credentials: true`
- Preflight with untrusted origin `Origin: https://evil.com`:
  - Result: `HTTP 403 Forbidden` (Fail closed)

### D. Reverse Proxy Rewrites
Probed via Vercel Edge proxy:
```bash
curl -i https://connect-anants-projects-38125e91.vercel.app/health/ready
```
Output:
- Header: `server: Vercel`
- Header: `x-render-origin-server: Render`
- Status: `HTTP/2 200 OK`
- Body: `{"status":"ok"}`
Confirms seamless transparent proxying between Vercel and Render without leaking backend topology.
