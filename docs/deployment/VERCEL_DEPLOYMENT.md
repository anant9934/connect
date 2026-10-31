# CONNECT — VERCEL FRONTEND DEPLOYMENT RUNBOOK

**Document ID:** `CONNECT-DEPLOY-VERCEL-20261101`
**Repository:** `https://github.com/anant9934/connect`
**Target Branch:** `main`
**Application Target:** `connect-main/apps/web` (Next.js 14 App Router)
**Lead Engineer:** Next.js Deployment Engineer & SRE
**Date:** November 1, 2026

---

## 1. PREREQUISITES & ARCHITECTURE MAPPING

The frontend application is located in a subfolder of the monorepo: `connect-main/apps/web`.

### Key Settings Required in Vercel:
- **Framework Preset:** `Next.js`
- **Root Directory:** `connect-main/apps/web` (Mandatory: do NOT use `.`)
- **Node.js Version:** `20.x` or `22.x`
- **Build Command:** `npm run build` (or Next.js default)
- **Output Directory:** `.next` (Next.js default)
- **Install Command:** `npm install`

---

## 2. STEP-BY-STEP VERCEL DEPLOYMENT PROCEDURE

### Step 1: Import Repository
1. Log in to [Vercel Dashboard](https://vercel.com/dashboard).
2. Click **Add New...** -> **Project**.
3. Under **Import Git Repository**, select `anant9934/connect`.
4. Leave the production branch as `main`.

### Step 2: Configure Project Settings (Root Directory)
> [!IMPORTANT]
> In the **Configure Project** screen, click **Edit** next to **Root Directory**.
> Select `connect-main/apps/web` and click **Continue**.
> Vercel will automatically detect `Next.js` as the framework preset.

### Step 3: Configure Environment Variables
In the **Environment Variables** section, add the following:

| Variable Name | Environment | Value Description |
| :--- | :--- | :--- |
| `INTERNAL_API_URL` | Production, Preview | The Render backend URL: e.g. `https://tathastu-connect-api.onrender.com` |
| `NEXT_PUBLIC_API_URL` | Production, Preview | Leave blank (to use same-origin relative proxy rewrites) OR enter `https://tathastu-connect-api.onrender.com` |
| `NEXT_PUBLIC_SUPABASE_URL` | Production, Preview | `https://qirzlvahobehykkkgouz.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Production, Preview | `sb_publishable_okoG8yzDLmuKbZQOUwvbxA_nzIKntvd` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Production, Preview | `sb_publishable_okoG8yzDLmuKbZQOUwvbxA_nzIKntvd` |
| `NEXT_PUBLIC_LIVEKIT_URL` | Production, Preview | `wss://[your-project].livekit.cloud` (LiveKit Cloud WebSockets URL) |

### Step 4: Deploy & Monitor
1. Click **Deploy**.
2. Wait for the build and deployment process to complete (~1-2 minutes).
3. Confirm build log outputs:
   - Next.js route compilation succeeds without TypeScript or ESLint errors.
   - Static pages and App Router routes generated.
   - Output artifacts collected.

---

## 3. POST-DEPLOYMENT VERIFICATION

Once deployed, verify the deployment URL:

1. **Homepage & Landing Experience:**
   - Navigate to `https://[your-app].vercel.app`.
   - Verify Three.js 3D hero loads cleanly with smooth animation.
   - Verify responsiveness on mobile viewport.

2. **Backend API Proxy Verification:**
   - Execute in terminal:
     ```bash
     curl -i https://[your-app].vercel.app/health/live
     ```
   - Expected Response: `HTTP/1.7 200 OK` with JSON `{"status":"live"}` proxied from Render backend via Next.js rewrites.

3. **Security Headers Verification:**
   - Execute in terminal:
     ```bash
     curl -I https://[your-app].vercel.app/
     ```
   - Verify response headers:
     - `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload`
     - `X-Content-Type-Options: nosniff`
     - `X-Frame-Options: DENY`
     - `Referrer-Policy: strict-origin-when-cross-origin`

4. **Authentication & Session Flow:**
   - Test navigating to `/sign-in` and `/sign-up`.
   - Complete login and verify `__Host-tc_session` or `tc_session` cookie is attached.
   - Verify redirect to authenticated dashboard `/rooms`.
