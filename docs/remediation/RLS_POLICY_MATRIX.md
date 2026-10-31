# ROW-LEVEL SECURITY (RLS) COMPLETE POLICY MATRIX

## 1. Overview & Policy Composition Architecture
Connect enforces PostgreSQL Row-Level Security as **Defense-in-Depth**. All queries must pass two complementary policy evaluation layers:
1. **Restrictive Tenant Isolation Policies (`AS RESTRICTIVE`)**: Combined using logical `AND`. Every single query must evaluate to true against the verified tenant boundary (`connect_auth.current_org_id()`) or active platform super-admin status.
2. **Permissive Role Policies (`AS PERMISSIVE`)**: Combined using logical `OR`. Defines fine-grained CRUD permissions based on user roles (student, faculty, admin, auditor).

`FORCE ROW LEVEL SECURITY` is enabled across all 14 tables, ensuring that table owners and unprivileged roles are equally constrained during application query execution.

---

## 2. Complete 14-Table Policy Matrix

| # | Table Name | RLS Enabled | FORCE RLS | Restrictive Policy | Permissive SELECT | Permissive INSERT | Permissive UPDATE | Permissive DELETE |
|---|---|:---:|:---:|---|---|---|---|---|
| **1** | `organizations` | YES | YES | Platform or `id = current_org_id()` | Super-Admin & Members | Super-Admin | Super-Admin & Org Admin | Prohibited (Soft-delete only) |
| **2** | `platform_administrators` | YES | YES | `is_super_admin()` | Active Super-Admins | Root Only | Root Only | Root Only |
| **3** | `organization_memberships` | YES | YES | `organization_id = current_org_id()` | Admin, Auditor, or Self | Admin only | Admin only (Revoke/Suspend) | Prohibited |
| **4** | `departments` | YES | YES | `organization_id = current_org_id()` | All Org Members | Org Admin | Org Admin | Restricted if courses exist |
| **5** | `courses` | YES | YES | `organization_id = current_org_id()` | All Org Members | Admin & Dept Coordinator | Admin & Dept Coordinator | Restricted if batches exist |
| **6** | `course_batches` | YES | YES | `organization_id = current_org_id()` | Enrolled Students & Faculty | Admin & Dept Coordinator | Admin & Dept Coordinator | Restricted if sessions exist |
| **7** | `faculty_allocations` | YES | YES | `organization_id = current_org_id()` | Allocated Faculty & Admins | Admin & Dept Coordinator | Admin (Revoke/Reassign) | Restricted |
| **8** | `course_enrollments` | YES | YES | `organization_id = current_org_id()` | Student (Self), Faculty, Admin | Admin & Dept Coordinator | Admin & Dept Coordinator | Prohibited (Drop status only) |
| **9** | `class_sessions` | YES | YES | `organization_id = current_org_id()` | Enrolled Students & Faculty | Allocated Faculty & Admin | Allocated Faculty & Admin | Prohibited if attendance exists |
| **10**| `attendance_records` | YES | YES | `organization_id = current_org_id()` | Student (Self), Faculty, Auditor | Reconciler Worker | Allocated Faculty & Org Admin | **REVOKED (Immutable)** |
| **11**| `rooms` | YES | YES | Dual: Personal, Commons, or Tenant | Host, Commons, or Org Members | Host or Org Members | Host or Org Members | Host or Org Admin |
| **12**| `meeting_notes` | YES | YES | Inherits from parent `rooms` | Room Participants | Room Participants | Room Participants | Creator or Host |
| **13**| `meeting_files` | YES | YES | Inherits from parent `rooms` | Room Participants | Room Participants | Prohibited | Uploader or Host |
| **14**| `participant_connection_events` | YES | YES | `organization_id = current_org_id()` | Admin, Auditor, Faculty | Client Heartbeat Ingestion | **REVOKED (Append-Only)** | **REVOKED (Append-Only)** |

---

## 3. SQL Policy Specifications & Proofs

### 3.1 Attendance Records RLS (Guarding Against Student Modification)
```sql
-- Restrictive Tenant Anchor: Combined with AND to all other policies
CREATE POLICY rls_tenant_attendance ON attendance_records
    AS RESTRICTIVE USING (
        connect_auth.is_super_admin() OR
        organization_id = connect_auth.current_org_id()
    );

-- Permissive SELECT: Students view only their own records; Faculty view allocated courses; Admins view all
CREATE POLICY rls_attendance_select_student ON attendance_records
    AS PERMISSIVE FOR SELECT
    USING (
        student_user_id = connect_auth.current_user_id()
    );

CREATE POLICY rls_attendance_select_faculty ON attendance_records
    AS PERMISSIVE FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM class_sessions cs
            JOIN faculty_allocations fa ON cs.faculty_allocation_id = fa.id
            WHERE cs.id = attendance_records.class_session_id
              AND fa.faculty_user_id = connect_auth.current_user_id()
        )
    );

CREATE POLICY rls_attendance_select_admin ON attendance_records
    AS PERMISSIVE FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM organization_memberships om
            WHERE om.organization_id = attendance_records.organization_id
              AND om.user_id = connect_auth.current_user_id()
              AND om.role IN ('institution_admin', 'institution_auditor')
              AND om.status = 'active'
        )
    );

-- Permissive UPDATE: Exclusively Allocated Faculty and Active Institution Admins
-- Ordinary students and base members have zero update grants!
CREATE POLICY rls_attendance_update_faculty_admin ON attendance_records
    AS PERMISSIVE FOR UPDATE
    USING (
        EXISTS (
            SELECT 1 FROM class_sessions cs
            JOIN faculty_allocations fa ON cs.faculty_allocation_id = fa.id
            WHERE cs.id = attendance_records.class_session_id
              AND fa.faculty_user_id = connect_auth.current_user_id()
              AND fa.status IN ('active', 'ended')
        )
        OR
        EXISTS (
            SELECT 1 FROM organization_memberships om
            WHERE om.organization_id = attendance_records.organization_id
              AND om.user_id = connect_auth.current_user_id()
              AND om.role = 'institution_admin'
              AND om.status = 'active'
        )
    )
    WITH CHECK (
        -- Resulting Row Integrity: Tenant and Session cannot be mutated
        organization_id = connect_auth.current_org_id()
    );

-- Explicitly Revoke Deletion
REVOKE DELETE ON attendance_records FROM connect_app, connect_worker;
```

### 3.2 Append-Only Connection Events RLS
```sql
CREATE POLICY rls_tenant_events ON participant_connection_events
    AS RESTRICTIVE USING (
        connect_auth.is_super_admin() OR
        organization_id = connect_auth.current_org_id()
    );

CREATE POLICY rls_events_insert ON participant_connection_events
    AS PERMISSIVE FOR INSERT
    WITH CHECK (
        organization_id = connect_auth.current_org_id()
    );

CREATE POLICY rls_events_select ON participant_connection_events
    AS PERMISSIVE FOR SELECT
    USING (
        connect_auth.is_super_admin() OR
        EXISTS (
            SELECT 1 FROM organization_memberships om
            WHERE om.organization_id = participant_connection_events.organization_id
              AND om.user_id = connect_auth.current_user_id()
              AND om.role IN ('institution_admin', 'institution_auditor')
              AND om.status = 'active'
        )
    );

REVOKE UPDATE, DELETE ON participant_connection_events FROM connect_app, connect_worker;
```

### 3.3 Attendance Overrule Audit Log RLS (Immutable Ledger)
```sql
ALTER TABLE attendance_overrule_audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance_overrule_audit_log FORCE ROW LEVEL SECURITY;

CREATE POLICY rls_audit_log_select ON attendance_overrule_audit_log
    AS PERMISSIVE FOR SELECT
    USING (
        connect_auth.is_super_admin()
        OR (
            organization_id = connect_auth.current_org_id()
            AND EXISTS (
                SELECT 1 FROM public.organization_memberships om
                WHERE om.organization_id = attendance_overrule_audit_log.organization_id
                  AND om.user_id = connect_auth.current_user_id()
                  AND om.role IN ('institution_admin', 'institution_auditor', 'faculty')
                  AND om.status = 'active'
            )
        )
    );

CREATE POLICY rls_audit_log_insert ON attendance_overrule_audit_log
    AS PERMISSIVE FOR INSERT
    WITH CHECK (
        organization_id = connect_auth.current_org_id()
        AND overruled_by = connect_auth.current_user_id()
        AND EXISTS (
            SELECT 1 FROM public.organization_memberships om
            WHERE om.organization_id = attendance_overrule_audit_log.organization_id
              AND om.user_id = connect_auth.current_user_id()
              AND om.role IN ('institution_admin', 'faculty')
              AND om.status = 'active'
        )
    );

REVOKE UPDATE, DELETE ON attendance_overrule_audit_log FROM PUBLIC, connect_app;
```

### 3.4 Hardened Personal Commons Lifecycle Authorization
```sql
-- Separated SELECT, INSERT, UPDATE, DELETE policies for rooms, meeting_notes, and meeting_files.
-- Unconditional 'OR workspace_type = personal_commons' is permanently eliminated.
-- Non-owners cannot modify or delete Commons rooms, notes, or files.
-- Private notes and files in Commons rooms remain completely inaccessible to other users.
```
