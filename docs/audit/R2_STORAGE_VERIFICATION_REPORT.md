# CLOUDFLARE R2 OBJECT STORAGE VERIFICATION REPORT

**Target Environment:** Production Cloudflare R2 (`https://832b6a4050f19e6433b440106ad234e7.r2.cloudflarestorage.com`)
**Bucket:** `connect`
**Deployment Date:** 2026-10-31 / 2026-11-01
**Auditor:** Application Security Engineer & Storage SRE
**Repository:** `https://github.com/anant9934/connect`
**Current HEAD Commit:** `49264bd8a11bd32edcc067f0487cc965f15f7d86`

---

## 1. Executive Summary

This report documents the verification of the Cloudflare R2 object storage lifecycle, including upload, download, metadata containment, size limits, and access controls.

**CRITICAL DEFECT IDENTIFIED — OWNER ACTION REQUIRED:**
Direct S3 API probing against the live bucket `connect` using the deployed credentials confirmed:
- `ListObjectsV2`: **SUCCESS (`200 OK`)**
- `PutObject`: **FAILED (`HTTP 403 Forbidden: AccessDenied`)**
- `DeleteObject`: **FAILED (`HTTP 403 Forbidden: AccessDenied`)**

**Root Cause:**
The Cloudflare R2 API token was created with **"Read and List objects"** permissions only (as confirmed in the dashboard screenshot), omitting **"Object Read & Write"** capabilities. Consequently, any file upload in the application fails with an S3 access denied error.

---

## 2. Empirical Verification Evidence

A test suite executed live AWS SDK for Go v2 calls using the production endpoint and credentials:

```text
Endpoint: https://832b6a4050f19e6433b440106ad234e7.r2.cloudflarestorage.com
Bucket: connect
Access Key ID: 8da530ce59ff4cadee83ce52c7c3a1a5
Region: auto

1. Testing ListObjectsV2...
ListObjectsV2 SUCCESS! Total keys: 0

2. Testing PutObject (key: audit-tests/phase-d-canary.txt, bytes: 64)...
PutObject FAILED: operation error S3: PutObject, https response error StatusCode: 403, RequestID: , HostID: , api error AccessDenied: Access Denied

3. Testing GetObject (key: audit-tests/phase-d-canary.txt)...
GetObject FAILED: operation error S3: GetObject, https response error StatusCode: 404, NoSuchKey: The specified key does not exist.

4. Testing DeleteObject (key: audit-tests/phase-d-canary.txt)...
DeleteObject FAILED: operation error S3: DeleteObject, https response error StatusCode: 403, api error AccessDenied: Access Denied
```

---

## 3. Storage Architecture in Application Code

Inspection of `connect-main/services/api/internal/files/storage.go` and `cmd/server/main.go`:
- Configuration setting: `STORAGE_PROVIDER=r2`.
- `NewR2StorageProvider` initializes the AWS S3 v2 client targeting Cloudflare R2 with path-style addressing (`o.UsePathStyle = true`).
- Does it fall back to local disk in production?
  - In `cmd/server/main.go` lines 140-157: If `cfg.StorageProvider == "r2"` fails initialization, it logs an error and exits (`os.Exit(1)`) in production mode to prevent silent disk drift.
  - However, because client construction succeeds at startup (lazy connection), the failure only occurs upon actual `PutObject` invocation during user uploads.

### Security Controls in Application Layer:
- **Maximum File Size:** Hard limit enforced at 25MB (`MaxFileSizeBytes = 25 * 1024 * 1024`) before streaming to storage.
- **Path Traversal Protection:**
  - `storage.go` line 196: `strings.TrimLeft(filepath.ToSlash(filepath.Clean(key)), "/")`.
  - Probed in security testing: Path traversal attempts (`../../../../etc/passwd`) are stopped and return `HTTP 404 / 400`.
- **Virus & Malware Scanning:**
  - `ProductionScanner` supports ClamAV daemon (`CLAMAV_ENABLED`). Set to `false` in production environment variables.

---

## 4. Remediation Steps (Owner Action Required)

To enable production file storage:
1. Navigate to Cloudflare Dashboard -> **R2 Object Storage** -> **Manage R2 API Tokens**.
2. Click **Create API Token**.
3. Under **Permissions**, select **Object Read & Write** (NOT "Read and List objects").
4. Under **Bucket**, select **connect** (or Apply to specific bucket: `connect`).
5. Under **TTL**, set according to organizational rotation policy.
6. Copy the new **Access Key ID** and **Secret Access Key**.
7. Update Render Environment Variables on `srv-dbj507nlk1mc73897go0`:
   - `R2_ACCESS_KEY_ID`: `<new-access-key-id>`
   - `R2_SECRET_ACCESS_KEY`: `<new-secret-access-key>`
8. Trigger a Render redeploy.
