# Operational Incident Response Runbook

## 1. Incident Classification Matrix

| Incident Type | Severity | Immediate Containment Action |
| :--- | :--- | :--- |
| **Suspected HMAC Secret Compromise** | P0 (Critical) | Rotate key in `connect_auth.internal_keys`, restart API servers, invalidate all active sessions. |
| **Cross-Tenant Data Leak** | P0 (Critical) | Force lock affected organization (`UPDATE organizations SET status = 'suspended'`). Verify RLS policy state. |
| **Stuck Migration or Lock Deadlock** | P1 (High) | Identify blocking PID with `SELECT pid, query FROM pg_stat_activity WHERE wait_event_type = 'Lock'`. Terminate blocker via `pg_cancel_backend()`. |
| **Worker Queue Starvation / Lease Storm** | P2 (Medium) | Inspect `background_jobs` for high `attempt_count`. Reap stale processing jobs or scale worker pods. |

---

## 2. Emergency Key Rotation Procedure
If the HMAC secret key in `connect_auth.internal_keys` is suspected of being leaked or compromised:
1. Connect via trusted migration admin role.
2. Generate a new 256-bit key:
   ```sql
   UPDATE connect_auth.internal_keys
   SET secret_key = public.gen_random_bytes(32),
       created_at = clock_timestamp()
   WHERE id = 1;
   ```
3. Terminate all open application transactions:
   ```sql
   SELECT pg_terminate_backend(pid)
   FROM pg_stat_activity
   WHERE usename IN ('connect_app', 'connect_worker');
   ```
4. All existing transaction signatures are invalidated immediately. Subsequent requests must re-authenticate via `connect_auth.authenticate_session`.
