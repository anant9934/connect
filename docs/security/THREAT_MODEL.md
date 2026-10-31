# STRIDE Threat Model & Security Analysis

## 1. STRIDE Analysis Matrix

| Threat Category | Attack Vector | Security Countermeasure Implemented |
| :--- | :--- | :--- |
| **Spoofing** | Attacker tampers with `app._user_id` or session variables via SQL injection or compromised application process. | HMAC-SHA256 signature calculated inside `SECURITY DEFINER` function using unreadable internal key. Any modification causes `constant_time_equals` failure. |
| **Tampering** | User attempts to elevate role (e.g. `student` to `institution_admin`) by setting `app._role`. | Role is cryptographically bound inside the HMAC payload. Tampering invalidates signature; RLS evaluates to NULL/empty. |
| **Repudiation** | Instructor falsely denies altering a student's attendance calculation. | `attendance_overrule_audit_log` records `overruled_by`, `old_status`, `new_status`, timestamp, and reason. Trigger prevents modification or deletion. |
| **Information Disclosure** | Cross-tenant data leakage via queries omitted from `WHERE organization_id = ...`. | `FORCE ROW LEVEL SECURITY` with `AS RESTRICTIVE` policies enforced on all 15 multi-tenant tables. Queries return 0 rows for other tenants. |
| **Denial of Service** | Worker crash holds lease on critical background job indefinitely. | Lease heartbeat mechanism and `locked_until < clock_timestamp()` recovery query in outbox worker automatically re-queues expired jobs. |
| **Elevation of Privilege** | Replay of valid HMAC signature across different transactions or connection pooling sessions. | Signature binds current PostgreSQL 64-bit transaction ID `pg_current_xact_id()`. Replay across transactions immediately fails closed. |

---

## 2. Side-Channel Timing Attack Protections
- **Vulnerability**: Standard string equality comparison (`=`) terminates on the first mismatched byte, leaking information about the valid HMAC token.
- **Resolution**: `connect_auth.constant_time_equals` performs bitwise XOR over the entire octet length of both operands, executing in constant time regardless of where differences occur.
