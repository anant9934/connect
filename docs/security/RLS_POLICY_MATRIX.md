# Row-Level Security Policy Matrix (15 Protected Tables)

## 1. Overview
All 15 domain and tenant-owned tables enforce `ROW LEVEL SECURITY` and `FORCE ROW LEVEL SECURITY`. Every table employs a defense-in-depth model combining an mandatory `AS RESTRICTIVE` boundary policy with granular `AS PERMISSIVE` action-specific policies.

---

## 2. Comprehensive Table Policy Matrix

| Table Name | Restrictive Policy | Permissive SELECT | Permissive INSERT | Permissive UPDATE | Permissive DELETE |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `organizations` | `rls_tenant_organizations` | Super-admin OR matching org member | Super-admin only | Super-admin OR institution admin | Super-admin only |
| `platform_administrators` | `rls_tenant_platform_administrators` | Super-admin OR self user | Super-admin only | Super-admin only | Super-admin only |
| `organization_memberships` | `rls_tenant_memberships` | Super-admin OR self user OR admin/auditor | Super-admin OR institution admin | Super-admin OR institution admin | Super-admin OR institution admin |
| `departments` | `rls_tenant_departments` | Current org members | Super-admin OR institution admin | Super-admin OR institution admin | Super-admin OR institution admin |
| `courses` | `rls_tenant_courses` | Current org members | Super-admin OR admin OR dept coordinator | Super-admin OR admin OR dept coordinator | Super-admin OR institution admin |
| `course_batches` | `rls_tenant_batches` | Current org members | Super-admin OR admin OR dept coordinator | Super-admin OR admin OR dept coordinator | Super-admin OR institution admin |
| `faculty_allocations` | `rls_tenant_allocations` | Super-admin OR admin/auditor/coordinator OR allocated faculty OR enrolled student | Super-admin OR admin OR dept coordinator | Super-admin OR admin OR dept coordinator | Super-admin OR institution admin |
| `course_enrollments` | `rls_tenant_enrollments` | Super-admin OR self student OR admin/auditor/coordinator OR allocated faculty | Super-admin OR admin OR dept coordinator | Super-admin OR admin OR dept coordinator | Super-admin OR institution admin |
| `class_sessions` | `rls_tenant_sessions` | Super-admin OR admin/auditor/coordinator OR allocated faculty OR enrolled student | Super-admin OR admin OR allocated faculty | Super-admin OR admin OR allocated faculty | Super-admin OR institution admin |
| `attendance_records` | `rls_tenant_attendance` | Self student OR allocated faculty OR admin/auditor | Super-admin OR admin OR allocated faculty | Super-admin OR admin OR allocated faculty | Revoked from all runtime roles |
| `attendance_overrule_audit_log` | None (table-level triggers) | Super-admin OR admin/auditor/faculty | Super-admin OR admin/faculty who overrules | Blocked by trigger (`immutable`) | Blocked by trigger (`immutable`) |
| `rooms` | None (dynamic multi-workspace) | Personal host OR org member OR unlocked Commons | Super-admin OR host (matching workspace type) | Super-admin OR host OR institution admin | Super-admin OR host OR institution admin |
| `meeting_notes` | None (inherits from room) | Personal host/author OR org member OR shared Commons | Author inside valid accessible room | Super-admin OR author only | Super-admin OR author only |
| `meeting_files` | None (inherits from room) | Personal host/uploader OR org member OR public Commons | Uploader inside valid accessible room | Super-admin OR uploader only | Super-admin OR uploader only |
| `participant_connection_events` | `rls_tenant_events` | Super-admin OR admin/auditor | Application & worker roles (append-only) | Revoked from all runtime roles | Revoked from all runtime roles |

---

## 3. Immutable Table Protections
The following tables are cryptographically and trigger-enforced as append-only ledgers:
- `participant_connection_events`: UPDATE and DELETE revoked at SQL privilege level.
- `attendance_records`: DELETE revoked at SQL privilege level.
- `attendance_overrule_audit_log`: Trigger `tr_block_audit_log_mutation` raises `restrict_violation` on any UPDATE or DELETE.
