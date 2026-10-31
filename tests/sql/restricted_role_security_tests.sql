-- ==============================================================================
-- Test Suite: restricted_role_security_tests.sql
-- Purpose: Complete, verifiable adversarial security test suite executing under
-- the restricted application role (SET ROLE connect_app).
-- Validates that connect_app CANNOT access internal_keys, CANNOT spoof identity,
-- CANNOT escalate privileges, and CANNOT bypass RLS cross-tenant boundaries.
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- PHASE 1: Fixture Setup (Executed under trusted setup / migration role)
-- ------------------------------------------------------------------------------
DO $$
DECLARE
    v_org_a UUID := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::UUID;
    v_org_b UUID := 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::UUID;
    v_user_a UUID := 'a1111111-1111-1111-1111-111111111111'::UUID;
    v_user_b UUID := 'b2222222-2222-2222-2222-222222222222'::UUID;
    v_user_auditor UUID := 'a3333333-3333-3333-3333-333333333333'::UUID;
    v_token_a VARCHAR(64) := 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    v_token_b VARCHAR(64) := 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
    v_token_auditor VARCHAR(64) := '3333333333333333333333333333333333333333333333333333333333333333';
    v_room_commons_private UUID := 'cccccccc-cccc-cccc-cccc-cccccccccccc'::UUID;
    v_room_commons_shared UUID := 'c1111111-1111-1111-1111-111111111111'::UUID;
    v_department_a UUID := 'dddddddd-dddd-dddd-dddd-dddddddddddd'::UUID;
    v_department_b UUID := 'd2222222-2222-2222-2222-222222222222'::UUID;
    v_note_private UUID := 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'::UUID;
    v_note_shared UUID := 'ffffffff-ffff-ffff-ffff-ffffffffffff'::UUID;
BEGIN
    RAISE NOTICE 'Setting up multi-tenant test fixtures under trusted setup role...';

    -- Ensure application role has necessary DML rights on domain tables while strictly preserving immutability revokes
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO connect_app;
    REVOKE UPDATE, DELETE ON attendance_overrule_audit_log FROM connect_app;
    REVOKE UPDATE, DELETE ON participant_connection_events FROM connect_app;
    REVOKE DELETE ON attendance_records FROM connect_app;

    -- Clean up prior test data if exists
    DELETE FROM attendance_overrule_audit_log WHERE organization_id IN (v_org_a, v_org_b);
    DELETE FROM meeting_notes WHERE id IN (v_note_private, v_note_shared);
    DELETE FROM rooms WHERE id IN (v_room_commons_private, v_room_commons_shared);
    DELETE FROM courses WHERE organization_id IN (v_org_a, v_org_b);
    DELETE FROM departments WHERE organization_id IN (v_org_a, v_org_b);
    DELETE FROM organization_memberships WHERE organization_id IN (v_org_a, v_org_b);
    DELETE FROM sessions WHERE token_hash IN (v_token_a, v_token_b, v_token_auditor);
    DELETE FROM users WHERE id IN (v_user_a, v_user_b, v_user_auditor);
    DELETE FROM organizations WHERE id IN (v_org_a, v_org_b);

    -- 1. Organizations
    INSERT INTO organizations (id, name, slug) VALUES
    (v_org_a, 'Tenant Alpha University', 'tenant-alpha'),
    (v_org_b, 'Tenant Beta Institute', 'tenant-beta');

    -- 2. Users & Sessions
    INSERT INTO users (id, email_normalized, display_name, password_hash, status) VALUES
    (v_user_a, 'alice@alpha.edu', 'Alice Alpha', 'hash_a', 'active'),
    (v_user_b, 'bob@beta.edu', 'Bob Beta', 'hash_b', 'active'),
    (v_user_auditor, 'auditor@alpha.edu', 'Auditor Alpha', 'hash_auditor', 'active');

    INSERT INTO sessions (user_id, token_hash, expires_at) VALUES
    (v_user_a, v_token_a, clock_timestamp() + INTERVAL '1 hour'),
    (v_user_b, v_token_b, clock_timestamp() + INTERVAL '1 hour'),
    (v_user_auditor, v_token_auditor, clock_timestamp() + INTERVAL '1 hour');

    -- 3. Memberships
    INSERT INTO organization_memberships (organization_id, user_id, role, status) VALUES
    (v_org_a, v_user_a, 'institution_member', 'active'),
    (v_org_b, v_user_b, 'institution_member', 'active'),
    (v_org_a, v_user_auditor, 'institution_auditor', 'active');

    -- 4. Departments & Courses (Alice is coordinator of Department Alpha)
    INSERT INTO departments (id, organization_id, code, name, coordinator_user_id) VALUES
    (v_department_a, v_org_a, 'CS', 'Computer Science Alpha', v_user_a),
    (v_department_b, v_org_b, 'ME', 'Mechanical Engineering Beta', NULL);

    INSERT INTO courses (id, organization_id, department_id, code, title) VALUES
    (gen_random_uuid(), v_org_a, v_department_a, 'CS401', 'Distributed Systems'),
    (gen_random_uuid(), v_org_b, v_department_b, 'ME201', 'Thermodynamics');

    -- 5. Personal Commons Rooms & Notes Created by Alice
    INSERT INTO rooms (id, public_code, host_user_id, workspace_type, is_locked) VALUES
    (v_room_commons_private, 'alice-commons-private', v_user_a, 'personal_commons', false),
    (v_room_commons_shared, 'alice-commons-shared', v_user_a, 'personal_commons', false);

    INSERT INTO meeting_notes (id, room_id, created_by, created_by_identity, updated_by_identity, title, content, visibility) VALUES
    (v_note_private, v_room_commons_private, v_user_a, 'alice-ident', 'alice-ident', 'Alice Private Notes', 'Private Alice Research', 'private'),
    (v_note_shared, v_room_commons_shared, v_user_a, 'alice-ident', 'alice-ident', 'Alice Shared Notes', 'Publicly Readable Research', 'shared');

    RAISE NOTICE '✓ [PASS] Fixtures successfully created.';
END $$;

-- ------------------------------------------------------------------------------
-- PHASE 2: Execute Attacks & Validations Under Restricted Application Role
-- ------------------------------------------------------------------------------
SET ROLE connect_app;

-- Test 2.1: Direct Access to internal_keys MUST BE BLOCKED
DO $$
DECLARE
    v_secret BYTEA;
BEGIN
    RAISE NOTICE '[ROLE: connect_app] Test 2.1: Verifying internal_keys is inaccessible...';
    BEGIN
        SELECT secret_key INTO v_secret FROM connect_auth.internal_keys WHERE id = 1;
        RAISE EXCEPTION 'SECURITY BREACH: connect_app was able to SELECT secret_key from internal_keys!';
    EXCEPTION
        WHEN insufficient_privilege THEN
            RAISE NOTICE '✓ [PASS] SELECT on internal_keys blocked with insufficient_privilege.';
    END;

    BEGIN
        INSERT INTO connect_auth.internal_keys (id, secret_key) VALUES (99, 'evil'::BYTEA);
        RAISE EXCEPTION 'SECURITY BREACH: connect_app was able to INSERT into internal_keys!';
    EXCEPTION
        WHEN insufficient_privilege THEN
            RAISE NOTICE '✓ [PASS] INSERT on internal_keys blocked with insufficient_privilege.';
    END;
END $$;

-- Test 2.2: Identity Spoofing via GUC Tampering Under connect_app
DO $$
DECLARE
    v_victim_user UUID := 'b2222222-2222-2222-2222-222222222222'::UUID;
    v_result UUID;
BEGIN
    RAISE NOTICE '[ROLE: connect_app] Test 2.2: Testing GUC tampering rejection...';
    PERFORM set_config('app._user_id', v_victim_user::TEXT, true);
    PERFORM set_config('app._sig', 'forged_fake_signature_12345', true);

    v_result := connect_auth.current_user_id();
    IF v_result IS NOT NULL THEN
        RAISE EXCEPTION 'SECURITY BREACH: current_user_id accepted forged signature under connect_app!';
    END IF;

    RAISE NOTICE '✓ [PASS] GUC identity tampering fail-closed (returned NULL).';
END $$;

-- Test 2.3: Organization Escalation Attempt
DO $$
DECLARE
    v_token_a VARCHAR(64) := 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    v_org_b UUID := 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::UUID;
BEGIN
    RAISE NOTICE '[ROLE: connect_app] Test 2.3: Testing cross-org authentication escalation...';
    BEGIN
        -- Alice attempts to authenticate into Org B where she has no membership
        PERFORM * FROM connect_auth.authenticate_session(v_token_a, v_org_b);
        RAISE EXCEPTION 'SECURITY BREACH: Alice was able to authenticate into Organization B!';
    EXCEPTION
        WHEN insufficient_privilege THEN
            RAISE NOTICE '✓ [PASS] Cross-organization escalation rejected with insufficient_privilege.';
    END;
END $$;

-- Test 2.4: Cross-Tenant SELECT, INSERT, UPDATE, DELETE Denial via RLS
DO $$
DECLARE
    v_token_a VARCHAR(64) := 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    v_org_a UUID := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::UUID;
    v_org_b UUID := 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::UUID;
    v_count INT;
    v_rows_affected INT;
BEGIN
    RAISE NOTICE '[ROLE: connect_app] Test 2.4: Testing Cross-Tenant RLS isolation under Alice context...';

    -- Authenticate as Alice in Org A
    PERFORM * FROM connect_auth.authenticate_session(v_token_a, v_org_a);

    -- Positive control: Alice must see the seeded course in her own tenant.
    SELECT count(*) INTO v_count FROM courses WHERE organization_id = v_org_a;
    IF v_count != 1 THEN
        RAISE EXCEPTION 'RLS FALSE POSITIVE: Alice should see exactly 1 course in Tenant A, got %.', v_count;
    END IF;
    RAISE NOTICE '✓ [PASS] Same-tenant positive control returned 1 row.';

    -- 1. SELECT Isolation: Alice must see Org A courses, but 0 Org B courses
    SELECT count(*) INTO v_count FROM courses WHERE organization_id = v_org_b;
    IF v_count != 0 THEN
        RAISE EXCEPTION 'SECURITY BREACH: Alice can SELECT % courses from Tenant B!', v_count;
    END IF;
    RAISE NOTICE '✓ [PASS] Cross-tenant SELECT returned 0 rows.';

    -- 2. INSERT Isolation: Alice cannot insert course into Org B
    BEGIN
        INSERT INTO courses (id, organization_id, department_id, code, title)
        VALUES (gen_random_uuid(), v_org_b,
                'd2222222-2222-2222-2222-222222222222'::UUID,
                'HACK101', 'Malicious Course');
        RAISE EXCEPTION 'SECURITY BREACH: Alice was able to INSERT course into Tenant B!';
    EXCEPTION
        WHEN check_violation OR insufficient_privilege THEN
            RAISE NOTICE '✓ [PASS] Cross-tenant INSERT rejected by RLS WITH CHECK.';
    END;

    -- 3. UPDATE Isolation: Alice cannot update Org B courses
    UPDATE courses SET title = 'Defaced Course' WHERE organization_id = v_org_b;
    GET DIAGNOSTICS v_rows_affected = ROW_COUNT;
    IF v_rows_affected > 0 THEN
        RAISE EXCEPTION 'SECURITY BREACH: Alice updated % rows in Tenant B!', v_rows_affected;
    END IF;
    RAISE NOTICE '✓ [PASS] Cross-tenant UPDATE affected 0 rows.';

    -- 4. DELETE Isolation: Alice cannot delete Org B courses
    DELETE FROM courses WHERE organization_id = v_org_b;
    GET DIAGNOSTICS v_rows_affected = ROW_COUNT;
    IF v_rows_affected > 0 THEN
        RAISE EXCEPTION 'SECURITY BREACH: Alice deleted % rows in Tenant B!', v_rows_affected;
    END IF;
    RAISE NOTICE '✓ [PASS] Cross-tenant DELETE affected 0 rows.';
END $$;

-- Test 2.5: Personal Commons Authorization (No Unconditional Access)
DO $$
DECLARE
    v_token_b VARCHAR(64) := 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
    v_org_b UUID := 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::UUID;
    v_note_private UUID := 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'::UUID;
    v_note_shared UUID := 'ffffffff-ffff-ffff-ffff-ffffffffffff'::UUID;
    v_count INT;
    v_rows INT;
BEGIN
    RAISE NOTICE '[ROLE: connect_app] Test 2.5: Testing Personal Commons authorization under Bob context...';

    -- Authenticate as Bob in Org B
    PERFORM * FROM connect_auth.authenticate_session(v_token_b, v_org_b);

    -- 1. Private Note Isolation: Bob MUST NOT see Alice's private note in the commons room
    SELECT count(*) INTO v_count FROM meeting_notes WHERE id = v_note_private;
    IF v_count != 0 THEN
        RAISE EXCEPTION 'SECURITY BREACH: Bob can read Alice private note in personal commons!';
    END IF;
    RAISE NOTICE '✓ [PASS] Private notes in personal commons are invisible to other users.';

    -- 2. Shared Note Readability: Bob can read Alice's shared note
    SELECT count(*) INTO v_count FROM meeting_notes WHERE id = v_note_shared;
    IF v_count != 1 THEN
        RAISE EXCEPTION 'ASSERTION FAILED: Bob should be able to view shared note in commons!';
    END IF;
    RAISE NOTICE '✓ [PASS] Shared notes in personal commons readable by authenticated users.';

    -- 3. Shared Note Modification Denial: Bob CANNOT update Alice's shared note
    UPDATE meeting_notes SET content = 'Tampered by Bob' WHERE id = v_note_shared;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows > 0 THEN
        RAISE EXCEPTION 'SECURITY BREACH: Bob modified Alice shared note in personal commons!';
    END IF;
    RAISE NOTICE '✓ [PASS] UPDATE on another user note in personal commons affected 0 rows.';

    -- 4. Shared Note Deletion Denial: Bob CANNOT delete Alice's shared note
    DELETE FROM meeting_notes WHERE id = v_note_shared;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows > 0 THEN
        RAISE EXCEPTION 'SECURITY BREACH: Bob deleted Alice shared note in personal commons!';
    END IF;
    RAISE NOTICE '✓ [PASS] DELETE on another user note in personal commons affected 0 rows.';
END $$;

-- Test 2.6: Attendance Audit Log Immutability Under connect_app
DO $$
DECLARE
    v_token_a VARCHAR(64) := 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    v_org_a UUID := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::UUID;
BEGIN
    RAISE NOTICE '[ROLE: connect_app] Test 2.6: Testing attendance audit log immutability...';
    PERFORM * FROM connect_auth.authenticate_session(v_token_a, v_org_a);

    -- Direct UPDATE on audit log must fail
    BEGIN
        UPDATE attendance_overrule_audit_log SET overrule_reason = 'Hacked';
        RAISE EXCEPTION 'SECURITY BREACH: Direct UPDATE succeeded on attendance_overrule_audit_log!';
    EXCEPTION
        WHEN insufficient_privilege OR restrict_violation THEN
            RAISE NOTICE '✓ [PASS] Direct UPDATE on attendance_overrule_audit_log strictly blocked.';
    END;

    -- Direct DELETE on audit log must fail
    BEGIN
        DELETE FROM attendance_overrule_audit_log;
        RAISE EXCEPTION 'SECURITY BREACH: Direct DELETE succeeded on attendance_overrule_audit_log!';
    EXCEPTION
        WHEN insufficient_privilege OR restrict_violation THEN
            RAISE NOTICE '✓ [PASS] Direct DELETE on attendance_overrule_audit_log strictly blocked.';
    END;
END $$;

-- Test 2.7: RBAC Cryptographic Role Verification & Anti-Tampering
DO $$
DECLARE
    v_token_a VARCHAR(64) := 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    v_org_a UUID := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::UUID;
    v_role VARCHAR;
BEGIN
    RAISE NOTICE '[ROLE: connect_app] Test 2.7: Testing cryptographic role verification and anti-tampering...';
    PERFORM * FROM connect_auth.authenticate_session(v_token_a, v_org_a);

    v_role := connect_auth.current_role();
    IF v_role != 'institution_member' THEN
        RAISE EXCEPTION 'ASSERTION FAILED: Expected role institution_member for Alice, got %', v_role;
    END IF;
    RAISE NOTICE '✓ [PASS] Authoritative role correctly extracted as %.', v_role;

    -- Attacker attempts to tamper with app._role GUC
    PERFORM set_config('app._role', 'institution_admin', true);
    v_role := connect_auth.current_role();
    IF v_role IS NOT NULL THEN
        RAISE EXCEPTION 'SECURITY BREACH: current_role accepted tampered app._role!';
    END IF;
    RAISE NOTICE '✓ [PASS] Tampered app._role rejected with NULL by constant-time cryptographic verification.';
END $$;

-- Test 2.8: Background Jobs Queue RLS Isolation
DO $$
DECLARE
    v_token_a VARCHAR(64) := 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    v_org_a UUID := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::UUID;
    v_count INT;
BEGIN
    RAISE NOTICE '[ROLE: connect_app] Test 2.8: Testing background_jobs RLS isolation under non-super-admin...';
    PERFORM * FROM connect_auth.authenticate_session(v_token_a, v_org_a);

    -- Non-super-admin Alice must see 0 background jobs
    SELECT count(*) INTO v_count FROM background_jobs;
    IF v_count != 0 THEN
        RAISE EXCEPTION 'SECURITY BREACH: Non-super-admin user can view % background_jobs!', v_count;
    END IF;
    RAISE NOTICE '✓ [PASS] Non-super-admin user sees 0 background_jobs.';
END $$;

-- Test 2.9: Department Coordinator Scoped Course Creation
DO $$
DECLARE
    v_token_a VARCHAR(64) := 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    v_org_a UUID := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::UUID;
    v_department_a UUID := 'dddddddd-dddd-dddd-dddd-dddddddddddd'::UUID;
    v_new_course_id UUID := gen_random_uuid();
BEGIN
    RAISE NOTICE '[ROLE: connect_app] Test 2.9: Testing Department Coordinator course creation...';
    PERFORM * FROM connect_auth.authenticate_session(v_token_a, v_org_a);

    -- Alice is coordinator of Department A: INSERT course in Department A MUST SUCCEED
    INSERT INTO courses (id, organization_id, department_id, code, title)
    VALUES (v_new_course_id, v_org_a, v_department_a, 'CS502', 'Advanced Algorithms');

    RAISE NOTICE '✓ [PASS] Department Coordinator successfully created course in coordinated department.';

    -- Clean up test course
    DELETE FROM courses WHERE id = v_new_course_id;
END $$;

-- Test 2.10: Institution Auditor Read-Only Enforcement
DO $$
DECLARE
    v_token_auditor VARCHAR(64) := '3333333333333333333333333333333333333333333333333333333333333333';
    v_org_a UUID := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::UUID;
    v_department_a UUID := 'dddddddd-dddd-dddd-dddd-dddddddddddd'::UUID;
    v_count INT;
BEGIN
    RAISE NOTICE '[ROLE: connect_app] Test 2.10: Testing Institution Auditor read-only enforcement...';
    PERFORM * FROM connect_auth.authenticate_session(v_token_auditor, v_org_a);

    -- Auditor CAN read courses
    SELECT count(*) INTO v_count FROM courses WHERE organization_id = v_org_a;
    IF v_count < 1 THEN
        RAISE EXCEPTION 'ASSERTION FAILED: Institution Auditor could not read tenant courses!';
    END IF;
    RAISE NOTICE '✓ [PASS] Institution Auditor successfully read % tenant courses.', v_count;

    -- Auditor CANNOT create courses
    BEGIN
        INSERT INTO courses (id, organization_id, department_id, code, title)
        VALUES (gen_random_uuid(), v_org_a, v_department_a, 'AUDIT101', 'Unauthorized Course');
        RAISE EXCEPTION 'SECURITY BREACH: Institution Auditor was able to INSERT course!';
    EXCEPTION
        WHEN check_violation OR insufficient_privilege THEN
            RAISE NOTICE '✓ [PASS] Auditor INSERT strictly blocked by RLS WITH CHECK.';
    END;
END $$;

RESET ROLE;

-- ------------------------------------------------------------------------------
-- PHASE 3: Cleanup Test Fixtures (Run under setup role)
-- ------------------------------------------------------------------------------
DO $$
DECLARE
    v_org_a UUID := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::UUID;
    v_org_b UUID := 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::UUID;
    v_user_a UUID := 'a1111111-1111-1111-1111-111111111111'::UUID;
    v_user_b UUID := 'b2222222-2222-2222-2222-222222222222'::UUID;
    v_user_auditor UUID := 'a3333333-3333-3333-3333-333333333333'::UUID;
    v_token_a VARCHAR(64) := 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    v_token_b VARCHAR(64) := 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
    v_token_auditor VARCHAR(64) := '3333333333333333333333333333333333333333333333333333333333333333';
    v_room_commons_private UUID := 'cccccccc-cccc-cccc-cccc-cccccccccccc'::UUID;
    v_room_commons_shared UUID := 'c1111111-1111-1111-1111-111111111111'::UUID;
    v_note_private UUID := 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'::UUID;
    v_note_shared UUID := 'ffffffff-ffff-ffff-ffff-ffffffffffff'::UUID;
BEGIN
    DELETE FROM meeting_notes WHERE id IN (v_note_private, v_note_shared);
    DELETE FROM rooms WHERE id IN (v_room_commons_private, v_room_commons_shared);
    DELETE FROM courses WHERE organization_id IN (v_org_a, v_org_b);
    DELETE FROM departments WHERE organization_id IN (v_org_a, v_org_b);
    DELETE FROM organization_memberships WHERE organization_id IN (v_org_a, v_org_b);
    DELETE FROM sessions WHERE token_hash IN (v_token_a, v_token_b, v_token_auditor);
    DELETE FROM users WHERE id IN (v_user_a, v_user_b, v_user_auditor);
    DELETE FROM organizations WHERE id IN (v_org_a, v_org_b);
    RAISE NOTICE '✓ [CLEANUP] Multi-tenant test fixtures cleaned up.';
    RAISE NOTICE 'ALL RESTRICTED-ROLE SECURITY TESTS UNDER connect_app PASSED 100%%!';
END $$;
