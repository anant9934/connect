-- ==============================================================================
-- Migration: 000008_auth_context_and_rls.sql
-- Stage C0.4: Cryptographically Verified Transaction-Bound Identity Context,
-- Database Role Separation, and Complete 14-Table Row-Level Security Matrix.
-- ==============================================================================

INSERT INTO schema_metadata (version, description)
VALUES ('000008_auth_context_and_rls', 'Cryptographically verified transaction-bound identity context and full 14-table RLS matrix')
ON CONFLICT (version) DO NOTHING;

-- 1. Create Private Auth Schema & Internal Key Store
CREATE SCHEMA IF NOT EXISTS connect_auth;

-- Provision runtime application and background worker roles before any GRANT/REVOKE references them.
-- This migration must run with CREATEROLE (or superuser) privileges.
DO $role$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'connect_app') THEN
        CREATE ROLE connect_app WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'connect_worker') THEN
        CREATE ROLE connect_worker WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
    END IF;
END
$role$;

REVOKE ALL ON SCHEMA connect_auth FROM PUBLIC;
REVOKE CREATE ON SCHEMA connect_auth FROM PUBLIC, connect_app, connect_worker;
REVOKE CREATE ON SCHEMA public FROM PUBLIC, connect_app, connect_worker;

CREATE TABLE IF NOT EXISTS connect_auth.internal_keys (
    id INT PRIMARY KEY DEFAULT 1,
    secret_key BYTEA NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.clock_timestamp()
);

-- Seed cryptographic HMAC secret if not present
INSERT INTO connect_auth.internal_keys (id, secret_key)
VALUES (1, public.gen_random_bytes(32))
ON CONFLICT (id) DO NOTHING;

REVOKE ALL ON TABLE connect_auth.internal_keys FROM PUBLIC;

-- 2. Cryptographic Constant-Time String Equality (Timing-Attack Resistant)
CREATE OR REPLACE FUNCTION connect_auth.constant_time_equals(a TEXT, b TEXT)
RETURNS BOOLEAN
IMMUTABLE
STRICT
PARALLEL SAFE
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
DECLARE
    v_len_a INT;
    v_len_b INT;
    v_diff INT := 0;
    i INT;
BEGIN
    IF a IS NULL OR b IS NULL THEN
        RETURN false;
    END IF;
    v_len_a := pg_catalog.octet_length(a);
    v_len_b := pg_catalog.octet_length(b);
    IF v_len_a != v_len_b THEN
        RETURN false;
    END IF;
    FOR i IN 1..v_len_a LOOP
        v_diff := v_diff | (pg_catalog.get_byte(a::BYTEA, i - 1) # pg_catalog.get_byte(b::BYTEA, i - 1));
    END LOOP;
    RETURN v_diff = 0;
END;
$$;

REVOKE ALL ON FUNCTION connect_auth.constant_time_equals(TEXT, TEXT) FROM PUBLIC;

-- 3. Authenticate Session Procedure (Generates HMAC Signature Bound to Transaction ID)
CREATE OR REPLACE FUNCTION connect_auth.authenticate_session(
    p_token_hash VARCHAR(64),
    p_requested_org_id UUID DEFAULT NULL
)
RETURNS TABLE (
    user_id UUID,
    organization_id UUID,
    role VARCHAR(32),
    is_super_admin BOOLEAN,
    auth_sig TEXT
)
SECURITY DEFINER
SET search_path = pg_catalog, public, connect_auth
LANGUAGE plpgsql AS $$
DECLARE
    v_user_id UUID;
    v_user_status VARCHAR(32);
    v_role VARCHAR(32) := NULL;
    v_mem_status VARCHAR(32) := NULL;
    v_is_super BOOLEAN := false;
    v_xid TEXT;
    v_exp BIGINT;
    v_secret BYTEA;
    v_payload TEXT;
    v_sig TEXT;
BEGIN
    -- 1. Authoritative Session Lookup (Explicitly Schema-Qualified)
    SELECT s.user_id, u.status INTO v_user_id, v_user_status
    FROM public.sessions s
    JOIN public.users u ON s.user_id = u.id
    WHERE s.token_hash = p_token_hash
      AND s.expires_at > pg_catalog.clock_timestamp()
      AND s.revoked_at IS NULL;

    IF v_user_id IS NULL OR v_user_status != 'active' THEN
        RAISE EXCEPTION 'Authentication Failed: Invalid, expired, or revoked session token'
            USING ERRCODE = 'invalid_authorization_specification';
    END IF;

    -- 2. Verify Platform Super Admin Status
    SELECT EXISTS (
        SELECT 1 FROM public.platform_administrators pa
        WHERE pa.user_id = v_user_id
          AND pa.role = 'platform_super_admin'
          AND pa.status = 'active'
    ) INTO v_is_super;

    -- 3. Verify Active Organization Membership
    IF p_requested_org_id IS NOT NULL THEN
        SELECT om.role, om.status INTO v_role, v_mem_status
        FROM public.organization_memberships om
        WHERE om.organization_id = p_requested_org_id
          AND om.user_id = v_user_id;

        IF (v_role IS NULL OR v_mem_status != 'active') AND NOT v_is_super THEN
            RAISE EXCEPTION 'Authorization Failed: User % has no active membership in Organization %',
                v_user_id, p_requested_org_id USING ERRCODE = 'insufficient_privilege';
        END IF;
    END IF;

    -- 4. Bind to Current 64-bit Transaction ID & Expiration Window
    v_xid := pg_catalog.pg_current_xact_id()::TEXT;
    v_exp := EXTRACT(epoch FROM (pg_catalog.clock_timestamp() + INTERVAL '10 minutes'))::BIGINT;

    -- 5. Retrieve Internal Secret & Compute HMAC-SHA256 Signature
    SELECT secret_key INTO v_secret FROM connect_auth.internal_keys WHERE id = 1;
    v_payload := v_user_id::TEXT || '|' || COALESCE(p_requested_org_id::TEXT, '') || '|' || v_is_super::TEXT || '|' || v_xid || '|' || v_exp::TEXT;
    v_sig := pg_catalog.encode(public.hmac(v_payload::BYTEA, v_secret, 'sha256'), 'hex');

    -- 6. Set Transaction-Local Session Variables (Scoped Strictly to this Transaction)
    PERFORM pg_catalog.set_config('app._user_id', v_user_id::TEXT, true);
    PERFORM pg_catalog.set_config('app._org_id', COALESCE(p_requested_org_id::TEXT, ''), true);
    PERFORM pg_catalog.set_config('app._is_super', CASE WHEN v_is_super THEN 'true' ELSE 'false' END, true);
    PERFORM pg_catalog.set_config('app._xid', v_xid, true);
    PERFORM pg_catalog.set_config('app._exp', v_exp::TEXT, true);
    PERFORM pg_catalog.set_config('app._sig', v_sig, true);

    RETURN QUERY SELECT v_user_id, p_requested_org_id, v_role, v_is_super, v_sig;
END;
$$;

REVOKE ALL ON FUNCTION connect_auth.authenticate_session(VARCHAR, UUID) FROM PUBLIC;

-- 3. Internal Cryptographic Verification Functions for RLS Policies
CREATE OR REPLACE FUNCTION connect_auth.current_org_id()
RETURNS UUID
SECURITY DEFINER
SET search_path = pg_catalog, public, connect_auth
LANGUAGE plpgsql STABLE AS $$
DECLARE
    v_user TEXT := pg_catalog.current_setting('app._user_id', true);
    v_org TEXT := pg_catalog.current_setting('app._org_id', true);
    v_super TEXT := pg_catalog.current_setting('app._is_super', true);
    v_xid TEXT := pg_catalog.current_setting('app._xid', true);
    v_exp TEXT := pg_catalog.current_setting('app._exp', true);
    v_sig TEXT := pg_catalog.current_setting('app._sig', true);
    v_secret BYTEA;
    v_expected_sig TEXT;
BEGIN
    IF v_user IS NULL OR v_xid IS NULL OR v_exp IS NULL OR v_sig IS NULL THEN
        RETURN NULL; -- Fail closed: Missing context
    END IF;

    -- Verify transaction binding
    IF v_xid != pg_catalog.pg_current_xact_id()::TEXT THEN
        RETURN NULL; -- Fail closed: Cross-transaction signature reuse
    END IF;

    -- Verify expiration
    IF EXTRACT(epoch FROM pg_catalog.clock_timestamp()) > v_exp::BIGINT THEN
        RETURN NULL; -- Fail closed: Expired context
    END IF;

    -- Verify cryptographic signature
    SELECT secret_key INTO v_secret FROM connect_auth.internal_keys WHERE id = 1;
    v_expected_sig := pg_catalog.encode(public.hmac((v_user || '|' || COALESCE(v_org, '') || '|' || COALESCE(v_super, 'false') || '|' || v_xid || '|' || v_exp)::BYTEA, v_secret, 'sha256'), 'hex');

    IF v_sig != v_expected_sig THEN
        RETURN NULL; -- Fail closed: Forged or tampered GUC parameters!
    END IF;

    IF v_org IS NULL OR v_org = '' THEN
        RETURN NULL;
    END IF;

    RETURN v_org::UUID;
END;
$$;

REVOKE ALL ON FUNCTION connect_auth.current_org_id() FROM PUBLIC;

CREATE OR REPLACE FUNCTION connect_auth.current_user_id()
RETURNS UUID
SECURITY DEFINER
SET search_path = pg_catalog, public, connect_auth
LANGUAGE plpgsql STABLE AS $$
DECLARE
    v_user TEXT := pg_catalog.current_setting('app._user_id', true);
    v_org TEXT := pg_catalog.current_setting('app._org_id', true);
    v_super TEXT := pg_catalog.current_setting('app._is_super', true);
    v_xid TEXT := pg_catalog.current_setting('app._xid', true);
    v_exp TEXT := pg_catalog.current_setting('app._exp', true);
    v_sig TEXT := pg_catalog.current_setting('app._sig', true);
    v_secret BYTEA;
    v_expected_sig TEXT;
BEGIN
    IF v_user IS NULL OR v_xid IS NULL OR v_exp IS NULL OR v_sig IS NULL THEN
        RETURN NULL;
    END IF;

    IF v_xid != pg_catalog.pg_current_xact_id()::TEXT THEN
        RETURN NULL;
    END IF;

    IF EXTRACT(epoch FROM pg_catalog.clock_timestamp()) > v_exp::BIGINT THEN
        RETURN NULL;
    END IF;

    SELECT secret_key INTO v_secret FROM connect_auth.internal_keys WHERE id = 1;
    v_expected_sig := pg_catalog.encode(public.hmac((v_user || '|' || COALESCE(v_org, '') || '|' || COALESCE(v_super, 'false') || '|' || v_xid || '|' || v_exp)::BYTEA, v_secret, 'sha256'), 'hex');

    IF v_sig != v_expected_sig THEN
        RETURN NULL;
    END IF;

    RETURN v_user::UUID;
END;
$$;

REVOKE ALL ON FUNCTION connect_auth.current_user_id() FROM PUBLIC;

CREATE OR REPLACE FUNCTION connect_auth.is_super_admin()
RETURNS BOOLEAN
SECURITY DEFINER
SET search_path = pg_catalog, public, connect_auth
LANGUAGE plpgsql STABLE AS $$
DECLARE
    v_user TEXT := pg_catalog.current_setting('app._user_id', true);
    v_org TEXT := pg_catalog.current_setting('app._org_id', true);
    v_super TEXT := pg_catalog.current_setting('app._is_super', true);
    v_xid TEXT := pg_catalog.current_setting('app._xid', true);
    v_exp TEXT := pg_catalog.current_setting('app._exp', true);
    v_sig TEXT := pg_catalog.current_setting('app._sig', true);
    v_secret BYTEA;
    v_expected_sig TEXT;
BEGIN
    IF v_user IS NULL OR v_xid IS NULL OR v_exp IS NULL OR v_sig IS NULL THEN
        RETURN false;
    END IF;

    IF v_xid != pg_catalog.pg_current_xact_id()::TEXT THEN
        RETURN false;
    END IF;

    IF EXTRACT(epoch FROM pg_catalog.clock_timestamp()) > v_exp::BIGINT THEN
        RETURN false;
    END IF;

    SELECT secret_key INTO v_secret FROM connect_auth.internal_keys WHERE id = 1;
    v_expected_sig := pg_catalog.encode(public.hmac((v_user || '|' || COALESCE(v_org, '') || '|' || COALESCE(v_super, 'false') || '|' || v_xid || '|' || v_exp)::BYTEA, v_secret, 'sha256'), 'hex');

    IF v_sig != v_expected_sig THEN
        RETURN false;
    END IF;

    RETURN (v_super = 'true');
END;
$$;

REVOKE ALL ON FUNCTION connect_auth.is_super_admin() FROM PUBLIC;

-- 4. Enable Row-Level Security & Force RLS Across All Protected Tables
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE organizations FORCE ROW LEVEL SECURITY;
ALTER TABLE platform_administrators ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_administrators FORCE ROW LEVEL SECURITY;
ALTER TABLE organization_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE organization_memberships FORCE ROW LEVEL SECURITY;
ALTER TABLE departments ENABLE ROW LEVEL SECURITY;
ALTER TABLE departments FORCE ROW LEVEL SECURITY;
ALTER TABLE courses ENABLE ROW LEVEL SECURITY;
ALTER TABLE courses FORCE ROW LEVEL SECURITY;
ALTER TABLE course_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE course_batches FORCE ROW LEVEL SECURITY;
ALTER TABLE faculty_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE faculty_allocations FORCE ROW LEVEL SECURITY;
ALTER TABLE course_enrollments ENABLE ROW LEVEL SECURITY;
ALTER TABLE course_enrollments FORCE ROW LEVEL SECURITY;
ALTER TABLE class_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE class_sessions FORCE ROW LEVEL SECURITY;
ALTER TABLE attendance_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance_records FORCE ROW LEVEL SECURITY;
ALTER TABLE rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE rooms FORCE ROW LEVEL SECURITY;
ALTER TABLE meeting_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE meeting_notes FORCE ROW LEVEL SECURITY;
ALTER TABLE meeting_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE meeting_files FORCE ROW LEVEL SECURITY;
ALTER TABLE participant_connection_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE participant_connection_events FORCE ROW LEVEL SECURITY;
ALTER TABLE attendance_overrule_audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance_overrule_audit_log FORCE ROW LEVEL SECURITY;

-- 5. Restrictive Tenant Boundary Policies (Using Cryptographically Verified Org Context)
CREATE POLICY rls_tenant_departments ON departments
    AS RESTRICTIVE USING (
        connect_auth.is_super_admin() OR
        organization_id = connect_auth.current_org_id()
    );

CREATE POLICY rls_tenant_courses ON courses
    AS RESTRICTIVE USING (
        connect_auth.is_super_admin() OR
        organization_id = connect_auth.current_org_id()
    );

-- Permissive read access for authenticated active members of the selected tenant.
-- authenticate_session() only establishes this context after validating active membership.
CREATE POLICY rls_departments_select_member ON departments
    AS PERMISSIVE FOR SELECT
    USING (organization_id = connect_auth.current_org_id());

CREATE POLICY rls_courses_select_member ON courses
    AS PERMISSIVE FOR SELECT
    USING (organization_id = connect_auth.current_org_id());

CREATE POLICY rls_tenant_batches ON course_batches
    AS RESTRICTIVE USING (
        connect_auth.is_super_admin() OR
        organization_id = connect_auth.current_org_id()
    );

CREATE POLICY rls_tenant_allocations ON faculty_allocations
    AS RESTRICTIVE USING (
        connect_auth.is_super_admin() OR
        organization_id = connect_auth.current_org_id()
    );

CREATE POLICY rls_tenant_enrollments ON course_enrollments
    AS RESTRICTIVE USING (
        connect_auth.is_super_admin() OR
        organization_id = connect_auth.current_org_id()
    );

CREATE POLICY rls_tenant_sessions ON class_sessions
    AS RESTRICTIVE USING (
        connect_auth.is_super_admin() OR
        organization_id = connect_auth.current_org_id()
    );

CREATE POLICY rls_tenant_attendance ON attendance_records
    AS RESTRICTIVE USING (
        connect_auth.is_super_admin() OR
        organization_id = connect_auth.current_org_id()
    );

CREATE POLICY rls_tenant_events ON participant_connection_events
    AS RESTRICTIVE USING (
        connect_auth.is_super_admin() OR
        organization_id = connect_auth.current_org_id()
    );

-- 6. Permissive Action Policies
-- Attendance Records:
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
        organization_id = connect_auth.current_org_id()
    );

-- Rooms: Explicitly Separated SELECT, INSERT, UPDATE, DELETE with Hardened Commons Protection
CREATE POLICY rls_rooms_select ON rooms
    AS PERMISSIVE FOR SELECT
    USING (
        connect_auth.is_super_admin()
        OR (workspace_type = 'personal_workspace' AND host_user_id = connect_auth.current_user_id())
        OR (workspace_type = 'institutional' AND organization_id = connect_auth.current_org_id())
        OR (
            workspace_type = 'personal_commons'
            AND (
                host_user_id = connect_auth.current_user_id()
                OR (connect_auth.current_user_id() IS NOT NULL AND is_locked = false)
            )
        )
    );

CREATE POLICY rls_rooms_insert ON rooms
    AS PERMISSIVE FOR INSERT
    WITH CHECK (
        connect_auth.is_super_admin()
        OR (workspace_type IN ('personal_workspace', 'personal_commons') AND host_user_id = connect_auth.current_user_id() AND organization_id IS NULL)
        OR (workspace_type = 'institutional' AND host_user_id = connect_auth.current_user_id() AND organization_id = connect_auth.current_org_id())
    );

CREATE POLICY rls_rooms_update ON rooms
    AS PERMISSIVE FOR UPDATE
    USING (
        connect_auth.is_super_admin()
        OR (workspace_type IN ('personal_workspace', 'personal_commons') AND host_user_id = connect_auth.current_user_id())
        OR (
            workspace_type = 'institutional'
            AND organization_id = connect_auth.current_org_id()
            AND (
                host_user_id = connect_auth.current_user_id()
                OR EXISTS (
                    SELECT 1 FROM public.organization_memberships om
                    WHERE om.organization_id = rooms.organization_id
                      AND om.user_id = connect_auth.current_user_id()
                      AND om.role = 'institution_admin'
                      AND om.status = 'active'
                )
            )
        )
    )
    WITH CHECK (
        connect_auth.is_super_admin()
        OR (workspace_type IN ('personal_workspace', 'personal_commons') AND host_user_id = connect_auth.current_user_id())
        OR (workspace_type = 'institutional' AND organization_id = connect_auth.current_org_id())
    );

CREATE POLICY rls_rooms_delete ON rooms
    AS PERMISSIVE FOR DELETE
    USING (
        connect_auth.is_super_admin()
        OR (workspace_type IN ('personal_workspace', 'personal_commons') AND host_user_id = connect_auth.current_user_id())
        OR (
            workspace_type = 'institutional'
            AND organization_id = connect_auth.current_org_id()
            AND (
                host_user_id = connect_auth.current_user_id()
                OR EXISTS (
                    SELECT 1 FROM public.organization_memberships om
                    WHERE om.organization_id = rooms.organization_id
                      AND om.user_id = connect_auth.current_user_id()
                      AND om.role = 'institution_admin'
                      AND om.status = 'active'
                )
            )
        )
    );

-- Meeting Notes: Separated Lifecycle Policies (Creator-Exclusive Modification in Commons)
CREATE POLICY rls_notes_select ON meeting_notes
    AS PERMISSIVE FOR SELECT
    USING (
        connect_auth.is_super_admin()
        OR EXISTS (
            SELECT 1 FROM public.rooms r
            WHERE r.id = meeting_notes.room_id
              AND (
                  (r.workspace_type = 'personal_workspace' AND (r.host_user_id = connect_auth.current_user_id() OR meeting_notes.created_by = connect_auth.current_user_id()))
                  OR (r.workspace_type = 'institutional' AND r.organization_id = connect_auth.current_org_id())
                  OR (
                      r.workspace_type = 'personal_commons'
                      AND (
                          meeting_notes.created_by = connect_auth.current_user_id()
                          OR (connect_auth.current_user_id() IS NOT NULL AND meeting_notes.visibility = 'shared')
                      )
                  )
              )
        )
    );

CREATE POLICY rls_notes_insert ON meeting_notes
    AS PERMISSIVE FOR INSERT
    WITH CHECK (
        connect_auth.is_super_admin()
        OR (
            created_by = connect_auth.current_user_id()
            AND EXISTS (
                SELECT 1 FROM public.rooms r
                WHERE r.id = meeting_notes.room_id
                  AND (
                      (r.workspace_type = 'personal_workspace' AND (r.host_user_id = connect_auth.current_user_id() OR meeting_notes.created_by = connect_auth.current_user_id()))
                      OR (r.workspace_type = 'institutional' AND r.organization_id = connect_auth.current_org_id())
                      OR (r.workspace_type = 'personal_commons' AND connect_auth.current_user_id() IS NOT NULL)
                  )
            )
        )
    );

CREATE POLICY rls_notes_update ON meeting_notes
    AS PERMISSIVE FOR UPDATE
    USING (
        connect_auth.is_super_admin()
        OR created_by = connect_auth.current_user_id()
    )
    WITH CHECK (
        connect_auth.is_super_admin()
        OR created_by = connect_auth.current_user_id()
    );

CREATE POLICY rls_notes_delete ON meeting_notes
    AS PERMISSIVE FOR DELETE
    USING (
        connect_auth.is_super_admin()
        OR created_by = connect_auth.current_user_id()
    );

-- Meeting Files: Separated Lifecycle Policies (Uploader-Exclusive Modification in Commons)
CREATE POLICY rls_files_select ON meeting_files
    AS PERMISSIVE FOR SELECT
    USING (
        connect_auth.is_super_admin()
        OR EXISTS (
            SELECT 1 FROM public.rooms r
            WHERE r.id = meeting_files.room_id
              AND (
                  (r.workspace_type = 'personal_workspace' AND (r.host_user_id = connect_auth.current_user_id() OR meeting_files.uploaded_by = connect_auth.current_user_id()))
                  OR (r.workspace_type = 'institutional' AND r.organization_id = connect_auth.current_org_id())
                  OR (
                      r.workspace_type = 'personal_commons'
                      AND (
                          meeting_files.uploaded_by = connect_auth.current_user_id()
                          OR (connect_auth.current_user_id() IS NOT NULL AND meeting_files.is_public = true)
                      )
                  )
              )
        )
    );

CREATE POLICY rls_files_insert ON meeting_files
    AS PERMISSIVE FOR INSERT
    WITH CHECK (
        connect_auth.is_super_admin()
        OR (
            uploaded_by = connect_auth.current_user_id()
            AND EXISTS (
                SELECT 1 FROM public.rooms r
                WHERE r.id = meeting_files.room_id
                  AND (
                      (r.workspace_type = 'personal_workspace' AND (r.host_user_id = connect_auth.current_user_id() OR meeting_files.uploaded_by = connect_auth.current_user_id()))
                      OR (r.workspace_type = 'institutional' AND r.organization_id = connect_auth.current_org_id())
                      OR (r.workspace_type = 'personal_commons' AND connect_auth.current_user_id() IS NOT NULL)
                  )
            )
        )
    );

CREATE POLICY rls_files_update ON meeting_files
    AS PERMISSIVE FOR UPDATE
    USING (
        connect_auth.is_super_admin()
        OR uploaded_by = connect_auth.current_user_id()
    )
    WITH CHECK (
        connect_auth.is_super_admin()
        OR uploaded_by = connect_auth.current_user_id()
    );

CREATE POLICY rls_files_delete ON meeting_files
    AS PERMISSIVE FOR DELETE
    USING (
        connect_auth.is_super_admin()
        OR uploaded_by = connect_auth.current_user_id()
    );

-- Attendance Overrule Audit Log: Tenant-Scoped Read and Strict Authorized Insert
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

-- Trigger Blocking Any Direct Modification or Deletion on Audit Records
CREATE OR REPLACE FUNCTION fn_block_audit_log_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
    RAISE EXCEPTION 'SECURITY VIOLATION: attendance_overrule_audit_log records are immutable and cannot be updated or deleted.'
        USING ERRCODE = 'restrict_violation';
END;
$$;

DROP TRIGGER IF EXISTS tr_block_audit_log_mutation ON attendance_overrule_audit_log;
CREATE TRIGGER tr_block_audit_log_mutation
    BEFORE UPDATE OR DELETE ON attendance_overrule_audit_log
    FOR EACH ROW EXECUTE FUNCTION fn_block_audit_log_mutation();

-- Append-Only Event Ledger
CREATE POLICY rls_events_insert ON participant_connection_events
    AS PERMISSIVE FOR INSERT
    WITH CHECK (
        organization_id = connect_auth.current_org_id()
    );

CREATE POLICY rls_events_select ON participant_connection_events
    AS PERMISSIVE FOR SELECT
    USING (
        connect_auth.is_super_admin()
        OR EXISTS (
            SELECT 1 FROM organization_memberships om
            WHERE om.organization_id = participant_connection_events.organization_id
              AND om.user_id = connect_auth.current_user_id()
              AND om.role IN ('institution_admin', 'institution_auditor')
              AND om.status = 'active'
        )
    );

-- Explicitly Revoke Destructive Operations on Immutable Tables
REVOKE DELETE ON attendance_records FROM PUBLIC;
REVOKE UPDATE, DELETE ON participant_connection_events FROM PUBLIC;
REVOKE UPDATE, DELETE ON attendance_overrule_audit_log FROM PUBLIC;

-- 5. Role Separation and Least-Privilege Enforcements (role provisioned above)

-- Blanket revocation of schema, table, and function privileges from PUBLIC
REVOKE ALL ON SCHEMA connect_auth FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA connect_auth FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA connect_auth FROM PUBLIC;

-- Mandatory Grants to Application and Background Worker Runtime Roles (No Silent Skipping)
GRANT USAGE ON SCHEMA connect_auth TO connect_app, connect_worker;
GRANT EXECUTE ON FUNCTION connect_auth.authenticate_session(VARCHAR, UUID) TO connect_app, connect_worker;
GRANT EXECUTE ON FUNCTION connect_auth.current_org_id() TO connect_app, connect_worker;
GRANT EXECUTE ON FUNCTION connect_auth.current_user_id() TO connect_app, connect_worker;
GRANT EXECUTE ON FUNCTION connect_auth.is_super_admin() TO connect_app, connect_worker;
GRANT EXECUTE ON FUNCTION connect_auth.constant_time_equals(TEXT, TEXT) TO connect_app, connect_worker;

-- Explicit Zero-Access Isolation on Internal HMAC Secret Table
REVOKE ALL ON TABLE connect_auth.internal_keys FROM PUBLIC, connect_app, connect_worker;
