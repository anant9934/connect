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
REVOKE ALL ON SCHEMA connect_auth FROM PUBLIC;

CREATE TABLE IF NOT EXISTS connect_auth.internal_keys (
    id INT PRIMARY KEY DEFAULT 1,
    secret_key BYTEA NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

-- Seed cryptographic HMAC secret if not present
INSERT INTO connect_auth.internal_keys (id, secret_key)
VALUES (1, gen_random_bytes(32))
ON CONFLICT (id) DO NOTHING;

REVOKE ALL ON TABLE connect_auth.internal_keys FROM PUBLIC;

-- 2. Authenticate Session Procedure (Generates HMAC Signature Bound to Transaction ID)
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
    -- 1. Authoritative Session Lookup
    SELECT s.user_id, u.status INTO v_user_id, v_user_status
    FROM public.sessions s
    JOIN public.users u ON s.user_id = u.id
    WHERE s.token_hash = p_token_hash
      AND s.expires_at > clock_timestamp()
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
    v_xid := pg_current_xact_id()::TEXT;
    v_exp := EXTRACT(EPOCH FROM (clock_timestamp() + INTERVAL '10 minutes'))::BIGINT;

    -- 5. Retrieve Internal Secret & Compute HMAC-SHA256 Signature
    SELECT secret_key INTO v_secret FROM connect_auth.internal_keys WHERE id = 1;
    v_payload := v_user_id::TEXT || '|' || COALESCE(p_requested_org_id::TEXT, '') || '|' || v_is_super::TEXT || '|' || v_xid || '|' || v_exp::TEXT;
    v_sig := encode(hmac(v_payload::BYTEA, v_secret, 'sha256'), 'hex');

    -- 6. Set Transaction-Local Session Variables (Scoped Strictly to this Transaction)
    PERFORM set_config('app._user_id', v_user_id::TEXT, true);
    PERFORM set_config('app._org_id', COALESCE(p_requested_org_id::TEXT, ''), true);
    PERFORM set_config('app._is_super', CASE WHEN v_is_super THEN 'true' ELSE 'false' END, true);
    PERFORM set_config('app._xid', v_xid, true);
    PERFORM set_config('app._exp', v_exp::TEXT, true);
    PERFORM set_config('app._sig', v_sig, true);

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
    v_user TEXT := current_setting('app._user_id', true);
    v_org TEXT := current_setting('app._org_id', true);
    v_super TEXT := current_setting('app._is_super', true);
    v_xid TEXT := current_setting('app._xid', true);
    v_exp TEXT := current_setting('app._exp', true);
    v_sig TEXT := current_setting('app._sig', true);
    v_secret BYTEA;
    v_expected_sig TEXT;
BEGIN
    IF v_user IS NULL OR v_xid IS NULL OR v_exp IS NULL OR v_sig IS NULL THEN
        RETURN NULL; -- Fail closed: Missing context
    END IF;

    -- Verify transaction binding
    IF v_xid != pg_current_xact_id()::TEXT THEN
        RETURN NULL; -- Fail closed: Cross-transaction signature reuse
    END IF;

    -- Verify expiration
    IF EXTRACT(EPOCH FROM clock_timestamp()) > v_exp::BIGINT THEN
        RETURN NULL; -- Fail closed: Expired context
    END IF;

    -- Verify cryptographic signature
    SELECT secret_key INTO v_secret FROM connect_auth.internal_keys WHERE id = 1;
    v_expected_sig := encode(hmac((v_user || '|' || COALESCE(v_org, '') || '|' || COALESCE(v_super, 'false') || '|' || v_xid || '|' || v_exp)::BYTEA, v_secret, 'sha256'), 'hex');

    IF v_sig != v_expected_sig THEN
        RETURN NULL; -- Fail closed: Forged or tampered GUC parameters!
    END IF;

    IF v_org IS NULL OR v_org = '' THEN
        RETURN NULL;
    END IF;

    RETURN v_org::UUID;
END;
$$;

CREATE OR REPLACE FUNCTION connect_auth.current_user_id()
RETURNS UUID
SECURITY DEFINER
SET search_path = pg_catalog, public, connect_auth
LANGUAGE plpgsql STABLE AS $$
DECLARE
    v_user TEXT := current_setting('app._user_id', true);
    v_org TEXT := current_setting('app._org_id', true);
    v_super TEXT := current_setting('app._is_super', true);
    v_xid TEXT := current_setting('app._xid', true);
    v_exp TEXT := current_setting('app._exp', true);
    v_sig TEXT := current_setting('app._sig', true);
    v_secret BYTEA;
    v_expected_sig TEXT;
BEGIN
    IF v_user IS NULL OR v_xid IS NULL OR v_exp IS NULL OR v_sig IS NULL THEN
        RETURN NULL;
    END IF;

    IF v_xid != pg_current_xact_id()::TEXT THEN
        RETURN NULL;
    END IF;

    IF EXTRACT(EPOCH FROM clock_timestamp()) > v_exp::BIGINT THEN
        RETURN NULL;
    END IF;

    SELECT secret_key INTO v_secret FROM connect_auth.internal_keys WHERE id = 1;
    v_expected_sig := encode(hmac((v_user || '|' || COALESCE(v_org, '') || '|' || COALESCE(v_super, 'false') || '|' || v_xid || '|' || v_exp)::BYTEA, v_secret, 'sha256'), 'hex');

    IF v_sig != v_expected_sig THEN
        RETURN NULL;
    END IF;

    RETURN v_user::UUID;
END;
$$;

CREATE OR REPLACE FUNCTION connect_auth.is_super_admin()
RETURNS BOOLEAN
SECURITY DEFINER
SET search_path = pg_catalog, public, connect_auth
LANGUAGE plpgsql STABLE AS $$
DECLARE
    v_user TEXT := current_setting('app._user_id', true);
    v_org TEXT := current_setting('app._org_id', true);
    v_super TEXT := current_setting('app._is_super', true);
    v_xid TEXT := current_setting('app._xid', true);
    v_exp TEXT := current_setting('app._exp', true);
    v_sig TEXT := current_setting('app._sig', true);
    v_secret BYTEA;
    v_expected_sig TEXT;
BEGIN
    IF v_user IS NULL OR v_xid IS NULL OR v_exp IS NULL OR v_sig IS NULL THEN
        RETURN false;
    END IF;

    IF v_xid != pg_current_xact_id()::TEXT THEN
        RETURN false;
    END IF;

    IF EXTRACT(EPOCH FROM clock_timestamp()) > v_exp::BIGINT THEN
        RETURN false;
    END IF;

    SELECT secret_key INTO v_secret FROM connect_auth.internal_keys WHERE id = 1;
    v_expected_sig := encode(hmac((v_user || '|' || COALESCE(v_org, '') || '|' || COALESCE(v_super, 'false') || '|' || v_xid || '|' || v_exp)::BYTEA, v_secret, 'sha256'), 'hex');

    IF v_sig != v_expected_sig THEN
        RETURN false;
    END IF;

    RETURN (v_super = 'true');
END;
$$;

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

-- Rooms: Dual Scope (Personal Workspace vs Institutional vs Commons)
CREATE POLICY rls_rooms_access ON rooms
    AS PERMISSIVE FOR ALL
    USING (
        connect_auth.is_super_admin()
        OR (workspace_type = 'personal_workspace' AND host_user_id = connect_auth.current_user_id())
        OR (workspace_type = 'personal_commons')
        OR (workspace_type = 'institutional' AND organization_id = connect_auth.current_org_id())
    )
    WITH CHECK (
        connect_auth.is_super_admin()
        OR (workspace_type = 'personal_workspace' AND host_user_id = connect_auth.current_user_id())
        OR (workspace_type = 'institutional' AND organization_id = connect_auth.current_org_id())
    );

-- Meeting Notes & Files: Inherit from Parent Room
CREATE POLICY rls_notes_parent ON meeting_notes
    AS PERMISSIVE FOR ALL
    USING (
        connect_auth.is_super_admin()
        OR EXISTS (
            SELECT 1 FROM rooms r
            WHERE r.id = meeting_notes.room_id
              AND (
                  (r.workspace_type = 'personal_workspace' AND (r.host_user_id = connect_auth.current_user_id() OR meeting_notes.created_by = connect_auth.current_user_id()))
                  OR (r.workspace_type = 'personal_commons')
                  OR (r.workspace_type = 'institutional' AND r.organization_id = connect_auth.current_org_id())
              )
        )
    );

CREATE POLICY rls_files_parent ON meeting_files
    AS PERMISSIVE FOR ALL
    USING (
        connect_auth.is_super_admin()
        OR EXISTS (
            SELECT 1 FROM rooms r
            WHERE r.id = meeting_files.room_id
              AND (
                  (r.workspace_type = 'personal_workspace' AND r.host_user_id = connect_auth.current_user_id())
                  OR (r.workspace_type = 'personal_commons')
                  OR (r.workspace_type = 'institutional' AND r.organization_id = connect_auth.current_org_id())
              )
        )
    );

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

-- 5. Role Separation, Mandatory Provisioning, and Least-Privilege Enforcements
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'connect_app') THEN
        CREATE ROLE connect_app WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
    END IF;
END $$;

-- Blanket revocation of schema, table, and function privileges from PUBLIC
REVOKE ALL ON SCHEMA connect_auth FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA connect_auth FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA connect_auth FROM PUBLIC;

-- Mandatory Grants to Application Runtime Role (No Silent Skipping)
GRANT USAGE ON SCHEMA connect_auth TO connect_app;
GRANT EXECUTE ON FUNCTION connect_auth.authenticate_session(VARCHAR, UUID) TO connect_app;
GRANT EXECUTE ON FUNCTION connect_auth.current_org_id() TO connect_app;
GRANT EXECUTE ON FUNCTION connect_auth.current_user_id() TO connect_app;
GRANT EXECUTE ON FUNCTION connect_auth.is_super_admin() TO connect_app;

-- Explicit Zero-Access Isolation on Internal HMAC Secret Table
REVOKE ALL ON TABLE connect_auth.internal_keys FROM PUBLIC, connect_app;
