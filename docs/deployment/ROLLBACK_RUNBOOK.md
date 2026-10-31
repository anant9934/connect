# CONNECT — PRODUCTION ROLLBACK RUNBOOK

**Document ID:** `CONNECT-ROLLBACK-20261101`
**Repository:** `https://github.com/anant9934/connect`
**Target Environments:** Vercel (Frontend) & Render (Backend Control Plane)
**Lead Engineer:** Site Reliability Engineer & Production SRE
**Date:** November 1, 2026

---

## 1. ROLLBACK TRIGGERS

Initiate an emergency rollback immediately if any of the following conditions occur after deployment:
1. **Critical Availability Outage:** HTTP 5xx error rate exceeds 2% across any 5-minute rolling window.
2. **Health Check Failure:** Render `/health/live` or `/health/ready` probe fails continuously for 3 consecutive checks.
3. **Database Connection Lockup:** Connection pool exhaustion or deadlocks blocking all query execution.
4. **Authentication Failure:** Legitimate users cannot log in or sessions are repeatedly rejected across all browsers.
5. **Security Breach / Leak:** Detection of secret leakage or broken authorization.

---

## 2. VERCEL FRONTEND INSTANT ROLLBACK

Vercel provides instant, zero-downtime rollback to any previous successful deployment artifact without re-building:

### Procedure (Dashboard):
1. Navigate to [Vercel Dashboard](https://vercel.com/dashboard) -> Select `connect` project.
2. Click on the **Deployments** tab.
3. Locate the previous known-good deployment (e.g. the deployment preceding the faulty release).
4. Click the three dots (`...`) on that deployment row and select **Instant Rollback** (or **Promote to Production**).
5. Confirm promotion.
6. Traffic is immediately redirected to the previous build within < 2 seconds.

---

## 3. RENDER BACKEND ROLLBACK

Render allows instant redeployment of previous build artifacts or redeployment to a specific Git commit SHA:

### Procedure (Dashboard):
1. Navigate to [Render Dashboard](https://dashboard.render.com) -> Select `tathastu-connect-api`.
2. Click on the **Events** or **Deploys** tab.
3. Locate the previous successful deploy.
4. Click **Rollback to this deploy**.
5. Render immediately stops routing traffic to faulty instances and switches active traffic to the rolled-back container image.

### Alternative (Git-Driven Rollback):
If an emergency code revert is required:
```bash
git revert HEAD --no-edit
git push origin main
```
Render and Vercel will trigger automated builds of the reverted commit.

---

## 4. DATABASE MIGRATION ROLLBACK STRATEGY

> [!CAUTION]
> **DATABASE SAFETY MANDATE**:
> - Never execute `DROP TABLE` or destructive SQL during an active incident rollback.
> - Connect database migrations are designed to be strictly **additive and backward-compatible**.

If a migration introduced an issue:
1. Identify the specific faulty migration index (e.g. `000008` or `000009`).
2. Do NOT drop user tables. If a newly created RLS policy is erroneously blocking access, alter or drop only the specific policy in an isolated transaction:
   ```sql
   BEGIN;
   -- Example: temporarily disable faulty policy while preserving table RLS
   ALTER TABLE target_table DISABLE ROW LEVEL SECURITY;
   -- or drop specific policy
   DROP POLICY IF EXISTS faulty_policy ON target_table;
   COMMIT;
   ```
3. Re-enable policy once corrected in a forward migration.

---

## 5. POST-ROLLBACK VERIFICATION CHECKLIST

After executing rollback:
- [ ] Confirm `/health/live` returns HTTP 200.
- [ ] Confirm `/health/ready` returns HTTP 200 with database and redis reporting `healthy`.
- [ ] Verify homepage loads at `https://[app].vercel.app`.
- [ ] Verify test login and room creation succeeds.
- [ ] Inspect Render runtime logs to confirm error rate has returned to zero.
- [ ] Notify engineering team and initiate Root Cause Analysis (RCA).
