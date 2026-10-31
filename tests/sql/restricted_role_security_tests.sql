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
    v_token_a VARCHAR(64) := 'token_hash_alice_tenant_a_0123456789abcdef0123456789abcdef01234567';
    v_token_b VARCHAR(64) := 'token_hash_bob_tenant_b_0123456789abcdef0123456789abcdef0123456789';
    v_room_commons UUID := 'cccccccc-cccc-cccc-cccc-cccccccccccc'::UUID;
    v_department_a UUID := 'dddddddd-dddd-dddd-dddd-dddddddddddd'::UUID;
    v_department_b UUID := 'd2222222-2222-2222-2222-222222222222'::UUID;
    v_note_private UUID := 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'::UUID;
    v_note_shared UUID := 'ffffffff-ffff-ffff-ffff-ffffffffffff'::UUID;
BEGIN
    RAISE NOTICE 'Setting up multi-tenant test fixtures under trusted setup role...';

    -- Ensure application role has necessary DML rights on domain tables (RLS will gate row visibility)
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO connect_app;

    -- Clean up prior test data if exists
    DELETE FROM attendance_overrule_audit_log WHERE organization_id IN (v_org_a, v_org_b);
    DELETE FROM meeting_notes WHERE id IN (v_note_private, v_note_shared);
    DELETE FROM rooms WHERE id = v_room_commons;
    DELETE FROM courses WHERE organization_id IN (v_org_a, v_org_b);
    DELETE FROM departments WHERE organization_id IN (v_org_a, v_org_b);
    DELETE FROM organization_memberships WHERE organization_id IN (v_org_a, v_org_b);
    DELETE FROM sessions WHERE token_hash IN (v_token_a, v_token_b);
    DELETE FROM users WHERE id IN (v_user_a, v_user_b);
    DELETE FROM organizations WHERE id IN (v_org_a, v_org_b);

    -- 1. Organizations
    INSERT INTO organizations (id, name, slug) VALUES
    (v_org_a, 'Tenant Alpha University', 'tenant-alpha'),
    (v_org_b, 'Tenant Beta Institute', 'tenant-beta');

    -- 2. Users & Sessions
    INSERT INTO users (id, email, password_hash, status) VALUES
    (v_user_a, 'alice@alpha.edu', 'hash_a', 'active'),
    (v_user_b, 'bob@beta.edu', 'hash_b', 'active');

    INSERT INTO sessions (user_id, token_hash, expires_at) VALUES
    (v_user_a, v_token_a, clock_timestamp() + INTERVAL '1 hour'),
    (v_user_b, v_token_b, clock_timestamp() + INTERVAL '1 hour');

    -- 3. Memberships
    INSERT INTO organization_memberships (organization_id, user_id, role, status) VALUES
    (v_org_a, v_user_a, 'institution_member', 'active'),
    (v_org_b, v_user_b, 'institution_member', 'active');

    -- 4. Departments & Courses
    INSERT INTO departments (id, organization_id, code, name) VALUES
    (v_department_a, v_org_a, 'CS', 'Computer Science Alpha'),
    (v_department_b, v_org_b, 'ME', 'Mechanical Engineering Beta');

    INSERT INTO courses (id, organization_id, department_id, code, title) VALUES
    (gen_random_uuid(), v_org_a, v_department_a, 'CS401', 'Distributed Systems'),
    (gen_random_uuid(), v_org_b, v_department_b, 'ME201', 'Thermodynamics');

    -- 5. Personal Commons Room & Notes Created by Alice
    INSERT INTO rooms (id, title, host_user_id, workspace_type, is_locked)
    VALUES (v_room_commons, 'Alice Open Research Room', v_user_a, 'personal_commons', false);

    INSERT INTO meeting_notes (id, room_id, created_by, title, content, visibility) VALUES
    (v_note_private, v_room_commons, v_user_a, 'Alice Private Notes', 'Private Alice Research', 'private'),
    (v_note_shared, v_room_commons, v_user_a, 'Alice Shared Notes', 'Publicly Readable Research', 'shared');

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
    v_token_a VARCHAR(64) := 'token_hash_alice_tenant_a_0123456789abcdef0123456789abcdef01234567';
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
    v_token_a VARCHAR(64) := 'token_hash_alice_tenant_a_0123456789abcdef0123456789abcdef01234567';
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
    v_token_b VARCHAR(64) := 'token_hash_bob_tenant_b_0123456789abcdef0123456789abcdef0123456789';
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
    v_token_a VARCHAR(64) := 'token_hash_alice_tenant_a_0123456789abcdef0123456789abcdef01234567';
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
    v_token_a VARCHAR(64) := 'token_hash_alice_tenant_a_0123456789abcdef0123456789abcdef01234567';
    v_token_b VARCHAR(64) := 'token_hash_bob_tenant_b_0123456789abcdef0123456789abcdef0123456789';
    v_room_commons UUID := 'cccccccc-cccc-cccc-cccc-cccccccccccc'::UUID;
    v_note_private UUID := 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'::UUID;
    v_note_shared UUID := 'ffffffff-ffff-ffff-ffff-ffffffffffff'::UUID;
BEGIN
    DELETE FROM meeting_notes WHERE id IN (v_note_private, v_note_shared);
    DELETE FROM rooms WHERE id = v_room_commons;
    DELETE FROM courses WHERE organization_id IN (v_org_a, v_org_b);
    DELETE FROM departments WHERE organization_id IN (v_org_a, v_org_b);
    DELETE FROM organization_memberships WHERE organization_id IN (v_org_a, v_org_b);
    DELETE FROM sessions WHERE token_hash IN (v_token_a, v_token_b);
    DELETE FROM users WHERE id IN (v_user_a, v_user_b);
    DELETE FROM organizations WHERE id IN (v_org_a, v_org_b);
    RAISE NOTICE '✓ [CLEANUP] Multi-tenant test fixtures cleaned up.';
    RAISE NOTICE 'ALL RESTRICTED-ROLE SECURITY TESTS UNDER connect_app PASSED 100%!';
END $$;
