# CONNECT — RENDER BACKEND DEPLOYMENT RUNBOOK

**Document ID:** `CONNECT-DEPLOY-RENDER-20261101`
**Repository:** `https://github.com/anant9934/connect`
**Target Branch:** `main`
**Application Target:** `connect-main/services/api` (Go 1.23 Web Control Plane)
**Lead Engineer:** Senior Go Backend Engineer & Production SRE
**Date:** November 1, 2026

---

## 1. PREREQUISITES & ARCHITECTURAL OVERVIEW

The backend control plane is a compiled Go service located at `connect-main/services/api`. It is containerized via a multi-stage Docker build producing a statically-linked, non-root Alpine binary.

### Deployment Parameters:
- **Service Type:** Web Service
- **Runtime:** `Docker`
- **Root Directory:** `connect-main` (or root `.` with Dockerfile `connect-main/services/api/Dockerfile`)
- **Dockerfile Path:** `./services/api/Dockerfile`
- **Docker Context Directory:** `./services/api`
- **Health Check Path:** `/health/live`
- **Port:** Render dynamically assigns `$PORT` (the Go server automatically reads `$PORT` and binds to `0.0.0.0:$PORT`).

---

## 2. STEP-BY-STEP RENDER DEPLOYMENT PROCEDURE

### Step 1: Create New Web Service on Render
1. Log in to [Render Dashboard](https://dashboard.render.com).
2. Click **New +** -> **Web Service**.
3. Select **Build and deploy from a Git repository**.
4. Connect and select repository: `anant9934/connect`.

### Step 2: Configure Service Details
Fill in the deployment form with the following settings:

| Setting | Value |
| :--- | :--- |
| **Name** | `tathastu-connect-api` |
| **Region** | Singapore (or closest region to your user base) |
| **Branch** | `main` |
| **Root Directory** | `connect-main` |
| **Runtime** | `Docker` |
| **Dockerfile Path** | `./services/api/Dockerfile` |
| **Docker Context** | `./services/api` |
| **Instance Type** | Starter (or higher) |

### Step 3: Configure Health Check Path
- Expand **Advanced**.
- Under **Health Check Path**, enter: `/health/live`.
- Leave **Auto-Deploy** as `Yes` (or `No` if manual approval is preferred).

### Step 4: Configure Environment Variables
Do not sync this service from `render.yaml`: it names a different service and region from the live one. For an existing
service, follow [ROLE_SEPARATION_RELEASE.md](ROLE_SEPARATION_RELEASE.md). The in-process worker runs inside this service
on its own pool, so no paid worker is needed. `scripts/provision_render_worker.sh` creates a paid standalone worker, needs
`WORKER_DATABASE_URL` from the operator and `CONFIRM_PAID_WORKER_PLAN=yes`, and should not run without owner approval.

Under **Environment Variables**, configure the production credentials (from [ENVIRONMENT_VARIABLES.md](file:///Users/quantum/Desktop/connect/docs/deployment/ENVIRONMENT_VARIABLES.md)):

```ini
APP_ENV=production
LOG_LEVEL=info
DATABASE_URL=postgres://connect_app:[password] (at) [pooler-host]/[db]?sslmode=require
WORKER_DATABASE_URL=postgres://connect_worker:[password] (at) [pooler-host]/[db]?sslmode=require
DB_MAX_OPEN_CONNS=25
DB_MAX_IDLE_CONNS=10
DB_CONN_MAX_LIFETIME_SEC=300
REDIS_URL=rediss://default:[PASSWORD]@[host]:6379
REDIS_TLS_ENABLED=true
RATE_LIMIT_ENABLED=true
RATE_LIMIT_RPS=100
RATE_LIMIT_BURST=200
CORS_ALLOWED_ORIGINS=https://connect.aitathastu.com,https://[your-app].vercel.app
PUBLIC_APP_ORIGIN=https://connect.aitathastu.com
LIVEKIT_URL=wss://[your-project].livekit.cloud
LIVEKIT_API_KEY=[your-livekit-api-key]
LIVEKIT_API_SECRET=[your-livekit-api-secret]
STORAGE_PROVIDER=r2
R2_ENDPOINT=https://[account-id].r2.cloudflarestorage.com
R2_BUCKET=connect-production-files
R2_ACCESS_KEY_ID=[your-r2-access-key]
R2_SECRET_ACCESS_KEY=[your-r2-secret-key]
R2_REGION=auto
CLAMAV_ENABLED=false
```

### Step 5: Deploy Web Service
1. Click **Create Web Service**.
2. Monitor build logs:
   - Multi-stage Docker builder compiles the Go binary statically.
   - Alpine runtime container packages the binary.
   - Non-root user `appuser (10001)` configured.
   - Container starts and reports:
     ```json
     {"time":"...","level":"INFO","msg":"application_initializing","version":"v0.1.0"}
     {"time":"...","level":"INFO","msg":"database_connected_successfully"}
     {"time":"...","level":"INFO","msg":"redis_connected_successfully"}
     {"time":"...","level":"INFO","msg":"server_ready_for_traffic","port":10000,"env":"production"}
     ```
3. Health check at `/health/live` passes, and the service transitions to **Live**.

---

## 3. POST-DEPLOYMENT BACKEND VERIFICATION

Execute the following commands against your live Render service URL:

1. **Liveness Probe:**
   ```bash
   curl -i https://[your-service].onrender.com/health/live
   ```
   Expected: `HTTP/1.1 200 OK`, `{"status":"live"}`.

2. **Readiness Probe:**
   ```bash
   curl -i https://[your-service].onrender.com/health/ready
   ```
   Expected: `HTTP/1.1 200 OK`, `{"status":"ready","database":"healthy","redis":"healthy"}`.

3. **System Status:**
   ```bash
   curl -i https://[your-service].onrender.com/api/v1/system/status
   ```
   Expected: `HTTP/1.1 200 OK`, `{"status":"operational","version":"v0.1.0"}`.

4. **Security Headers & CORS Rejection:**
   ```bash
   curl -i -H "Origin: https://malicious-site.com" https://[your-service].onrender.com/health/live
   ```
   Expected: CORS headers (`Access-Control-Allow-Origin`) are strictly omitted for unapproved origins.
