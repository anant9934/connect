-- ==============================================================================
-- Test Suite: privilege_and_rls_assertions.sql
-- Purpose: Formal, executable SQL assertions validating role provisioning,
-- schema permissions, function execution rights, and RLS enforcement.
-- ==============================================================================

DO $$
DECLARE
    v_count INT;
    v_is_super BOOLEAN;
    v_bypass_rls BOOLEAN;
BEGIN
    RAISE NOTICE 'Starting PostgreSQL 16 Security & Privilege Assertions...';

    -- 1. Verify connect_app Role Provisioning & Attributes
    SELECT rolsuper, rolbypassrls INTO v_is_super, v_bypass_rls
    FROM pg_roles
    WHERE rolname = 'connect_app';

    IF NOT FOUND THEN
        RAISE EXCEPTION 'ASSERTION FAILED: Role connect_app does not exist in pg_roles!';
    END IF;

    IF v_is_super THEN
        RAISE EXCEPTION 'SECURITY BREACH: Role connect_app must NOT be a SUPERUSER!';
    END IF;

    IF v_bypass_rls THEN
        RAISE EXCEPTION 'SECURITY BREACH: Role connect_app must NOT have BYPASSRLS privilege!';
    END IF;
    RAISE NOTICE '✓ [PASS] connect_app role exists with strictly non-superuser and non-bypassrls attributes.';

    -- 2. Verify Schema Usage Privileges
    IF has_schema_privilege('public', 'connect_auth', 'USAGE') THEN
        RAISE EXCEPTION 'SECURITY BREACH: PUBLIC role must NOT have USAGE on schema connect_auth!';
    END IF;

    IF NOT has_schema_privilege('connect_app', 'connect_auth', 'USAGE') THEN
        RAISE EXCEPTION 'ASSERTION FAILED: connect_app must have USAGE on schema connect_auth!';
    END IF;
    RAISE NOTICE '✓ [PASS] Schema connect_auth USAGE isolated strictly to connect_app (PUBLIC denied).';

    -- 3. Verify Function Execution Privileges (No PUBLIC EXECUTE on Security Definer)
    IF has_function_privilege('public', 'connect_auth.authenticate_session(varchar,uuid)', 'EXECUTE') THEN
        RAISE EXCEPTION 'SECURITY BREACH: PUBLIC must NOT have EXECUTE on connect_auth.authenticate_session!';
    END IF;

    IF has_function_privilege('public', 'connect_auth.current_org_id()', 'EXECUTE') THEN
        RAISE EXCEPTION 'SECURITY BREACH: PUBLIC must NOT have EXECUTE on connect_auth.current_org_id!';
    END IF;

    IF has_function_privilege('public', 'connect_auth.current_user_id()', 'EXECUTE') THEN
        RAISE EXCEPTION 'SECURITY BREACH: PUBLIC must NOT have EXECUTE on connect_auth.current_user_id!';
    END IF;

    IF has_function_privilege('public', 'connect_auth.is_super_admin()', 'EXECUTE') THEN
        RAISE EXCEPTION 'SECURITY BREACH: PUBLIC must NOT have EXECUTE on connect_auth.is_super_admin!';
    END IF;

    IF NOT has_function_privilege('connect_app', 'connect_auth.authenticate_session(varchar,uuid)', 'EXECUTE') THEN
        RAISE EXCEPTION 'ASSERTION FAILED: connect_app must have EXECUTE on connect_auth.authenticate_session!';
    END IF;
    RAISE NOTICE '✓ [PASS] Security Definer functions executable strictly by connect_app (PUBLIC denied).';

    -- 4. Verify HMAC Internal Key Table Inaccessibility (Zero Table Privilege)
    IF has_table_privilege('public', 'connect_auth.internal_keys', 'SELECT') OR
       has_table_privilege('public', 'connect_auth.internal_keys', 'INSERT') OR
       has_table_privilege('public', 'connect_auth.internal_keys', 'UPDATE') OR
       has_table_privilege('public', 'connect_auth.internal_keys', 'DELETE') THEN
        RAISE EXCEPTION 'SECURITY BREACH: PUBLIC must have ZERO table privileges on connect_auth.internal_keys!';
    END IF;

    IF has_table_privilege('connect_app', 'connect_auth.internal_keys', 'SELECT') OR
       has_table_privilege('connect_app', 'connect_auth.internal_keys', 'INSERT') OR
       has_table_privilege('connect_app', 'connect_auth.internal_keys', 'UPDATE') OR
       has_table_privilege('connect_app', 'connect_auth.internal_keys', 'DELETE') THEN
        RAISE EXCEPTION 'SECURITY BREACH: connect_app must have ZERO table privileges on connect_auth.internal_keys!';
    END IF;
    RAISE NOTICE '✓ [PASS] Cryptographic HMAC key table is completely inaccessible to connect_app and PUBLIC.';

    -- 5. Verify FORCE ROW LEVEL SECURITY Across All 14 Multi-Tenant Tables
    SELECT count(*) INTO v_count
    FROM pg_tables t
    JOIN pg_class c ON c.relname = t.tablename
    WHERE t.schemaname = 'public'
      AND t.tablename IN (
          'organizations', 'platform_administrators', 'organization_memberships',
          'departments', 'courses', 'course_batches', 'faculty_allocations',
          'course_enrollments', 'class_sessions', 'attendance_records',
          'attendance_overrule_audit_log', 'rooms', 'meeting_notes', 'meeting_files'
      )
      AND c.relrowsecurity = true
      AND c.relforcerowsecurity = true;

    IF v_count != 14 THEN
        RAISE EXCEPTION 'ASSERTION FAILED: Expected 14 tables with relrowsecurity AND relforcerowsecurity = true, got %', v_count;
    END IF;
    RAISE NOTICE '✓ [PASS] All 14 multi-tenant tables strictly enforce FORCE ROW LEVEL SECURITY.';

    -- 6. Verify Table Ownership
    SELECT count(*) INTO v_count
    FROM pg_tables
    WHERE schemaname = 'public'
      AND tableowner = 'connect_app';

    IF v_count > 0 THEN
        RAISE EXCEPTION 'SECURITY BREACH: connect_app must NOT own application tables (found % tables owned)', v_count;
    END IF;
    RAISE NOTICE '✓ [PASS] connect_app owns 0 tables. Table ownership separated from runtime application role.';

    RAISE NOTICE 'ALL POSTGRESQL 16 SECURITY PRIVILEGE ASSERTIONS PASSED SUCCESSFULLY!';
END $$;
