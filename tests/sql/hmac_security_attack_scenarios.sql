-- ==============================================================================
-- Test Suite: hmac_security_attack_scenarios.sql
-- Purpose: Executable security proof verifying 7 adversarial attack scenarios
-- against the HMAC-signed transaction-bound context and RLS enforcement.
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- Attack Scenario 1: Identity Spoofing via GUC Manipulation
-- ------------------------------------------------------------------------------
DO $$
DECLARE
    v_attacker_user UUID := '11111111-1111-1111-1111-111111111111'::UUID;
    v_victim_user UUID := '22222222-2222-2222-2222-222222222222'::UUID;
    v_result UUID;
BEGIN
    RAISE NOTICE 'Executing Attack Scenario 1: Identity Spoofing via GUC Manipulation...';

    -- Attacker attempts to forge victim user_id with arbitrary signature
    PERFORM set_config('app._user_id', v_victim_user::TEXT, true);
    PERFORM set_config('app._org_id', '', true);
    PERFORM set_config('app._is_super', 'false', true);
    PERFORM set_config('app._xid', pg_current_xact_id()::TEXT, true);
    PERFORM set_config('app._exp', (EXTRACT(EPOCH FROM clock_timestamp()) + 600)::BIGINT::TEXT, true);
    PERFORM set_config('app._sig', 'forged_or_random_signature_string_abcdef0123456789', true);

    v_result := connect_auth.current_user_id();
    IF v_result IS NOT NULL THEN
        RAISE EXCEPTION 'VULNERABILITY DETECTED: connect_auth.current_user_id accepted forged GUC signature! Result: %', v_result;
    END IF;

    RAISE NOTICE '✓ [BLOCKED] Attack 1 Neutralized: Forged signature returned NULL (Fail Closed).';
END $$;

-- ------------------------------------------------------------------------------
-- Attack Scenario 2: Horizontal Privilege Escalation via Organization ID Tampering
-- ------------------------------------------------------------------------------
DO $$
DECLARE
    v_user UUID := '11111111-1111-1111-1111-111111111111'::UUID;
    v_victim_org UUID := '99999999-9999-9999-9999-999999999999'::UUID;
    v_result UUID;
BEGIN
    RAISE NOTICE 'Executing Attack Scenario 2: Horizontal Org Escalation...';

    -- Attacker sets victim org without a valid signature covering victim org
    PERFORM set_config('app._user_id', v_user::TEXT, true);
    PERFORM set_config('app._org_id', v_victim_org::TEXT, true);
    PERFORM set_config('app._sig', 'invalid_sig', true);

    v_result := connect_auth.current_org_id();
    IF v_result IS NOT NULL THEN
        RAISE EXCEPTION 'VULNERABILITY DETECTED: connect_auth.current_org_id accepted tampered org! Result: %', v_result;
    END IF;

    RAISE NOTICE '✓ [BLOCKED] Attack 2 Neutralized: Tampered organization ID returned NULL.';
END $$;

-- ------------------------------------------------------------------------------
-- Attack Scenario 3: Vertical Privilege Escalation via Super-Admin Flag
-- ------------------------------------------------------------------------------
DO $$
DECLARE
    v_user UUID := '11111111-1111-1111-1111-111111111111'::UUID;
    v_result BOOLEAN;
BEGIN
    RAISE NOTICE 'Executing Attack Scenario 3: Vertical Super-Admin Escalation...';

    PERFORM set_config('app._user_id', v_user::TEXT, true);
    PERFORM set_config('app._is_super', 'true', true);
    PERFORM set_config('app._xid', pg_current_xact_id()::TEXT, true);
    PERFORM set_config('app._exp', (EXTRACT(EPOCH FROM clock_timestamp()) + 600)::BIGINT::TEXT, true);
    PERFORM set_config('app._sig', 'fake_sig', true);

    v_result := connect_auth.is_super_admin();
    IF v_result = true THEN
        RAISE EXCEPTION 'VULNERABILITY DETECTED: connect_auth.is_super_admin elevated privileges without valid signature!';
    END IF;

    RAISE NOTICE '✓ [BLOCKED] Attack 3 Neutralized: Forged super-admin flag returned false.';
END $$;

-- ------------------------------------------------------------------------------
-- Attack Scenario 4: Cross-Transaction Replay Attack
-- ------------------------------------------------------------------------------
DO $$
DECLARE
    v_secret BYTEA;
    v_user UUID := '11111111-1111-1111-1111-111111111111'::UUID;
    v_stale_xid TEXT := '999999999'; -- Mismatched transaction ID
    v_exp BIGINT := EXTRACT(EPOCH FROM (clock_timestamp() + INTERVAL '10 minutes'))::BIGINT;
    v_payload TEXT;
    v_valid_sig_for_stale_xid TEXT;
    v_result UUID;
BEGIN
    RAISE NOTICE 'Executing Attack Scenario 4: Cross-Transaction Replay Attack...';

    -- Generate signature with a stale xid
    SELECT secret_key INTO v_secret FROM connect_auth.internal_keys WHERE id = 1;
    v_payload := v_user::TEXT || '||false|' || v_stale_xid || '|' || v_exp::TEXT;
    v_valid_sig_for_stale_xid := encode(hmac(v_payload::BYTEA, v_secret, 'sha256'), 'hex');

    -- Replay that signature in the CURRENT transaction
    PERFORM set_config('app._user_id', v_user::TEXT, true);
    PERFORM set_config('app._org_id', '', true);
    PERFORM set_config('app._is_super', 'false', true);
    PERFORM set_config('app._xid', v_stale_xid, true);
    PERFORM set_config('app._exp', v_exp::TEXT, true);
    PERFORM set_config('app._sig', v_valid_sig_for_stale_xid, true);

    -- Even though the signature is mathematically valid for v_stale_xid,
    -- current transaction ID != v_stale_xid, so it must fail closed!
    v_result := connect_auth.current_user_id();
    IF v_result IS NOT NULL THEN
        RAISE EXCEPTION 'VULNERABILITY DETECTED: Cross-transaction replay attack succeeded!';
    END IF;

    RAISE NOTICE '✓ [BLOCKED] Attack 4 Neutralized: Replayed context from stale transaction rejected.';
END $$;

-- ------------------------------------------------------------------------------
-- Attack Scenario 5: Arbitrary Caller Token Forgery
-- ------------------------------------------------------------------------------
DO $$
BEGIN
    RAISE NOTICE 'Executing Attack Scenario 5: Arbitrary Caller Token Forgery...';

    BEGIN
        PERFORM * FROM connect_auth.authenticate_session(
            'nonexistent_fake_token_hash_0123456789abcdef0123456789abcdef01234567'
        );
        RAISE EXCEPTION 'VULNERABILITY DETECTED: authenticate_session accepted invalid token hash!';
    EXCEPTION
        WHEN invalid_authorization_specification THEN
            RAISE NOTICE '✓ [BLOCKED] Attack 5 Neutralized: Invalid session token rejected with invalid_authorization_specification.';
    END;
END $$;

-- ------------------------------------------------------------------------------
-- Attack Scenario 6: Expired Context Rejection
-- ------------------------------------------------------------------------------
DO $$
DECLARE
    v_secret BYTEA;
    v_user UUID := '11111111-1111-1111-1111-111111111111'::UUID;
    v_xid TEXT := pg_current_xact_id()::TEXT;
    v_expired_time BIGINT := EXTRACT(EPOCH FROM (clock_timestamp() - INTERVAL '5 seconds'))::BIGINT;
    v_payload TEXT;
    v_expired_sig TEXT;
    v_result UUID;
BEGIN
    RAISE NOTICE 'Executing Attack Scenario 6: Expired Context Rejection...';

    SELECT secret_key INTO v_secret FROM connect_auth.internal_keys WHERE id = 1;
    v_payload := v_user::TEXT || '||false|' || v_xid || '|' || v_expired_time::TEXT;
    v_expired_sig := encode(hmac(v_payload::BYTEA, v_secret, 'sha256'), 'hex');

    PERFORM set_config('app._user_id', v_user::TEXT, true);
    PERFORM set_config('app._org_id', '', true);
    PERFORM set_config('app._is_super', 'false', true);
    PERFORM set_config('app._xid', v_xid, true);
    PERFORM set_config('app._exp', v_expired_time::TEXT, true);
    PERFORM set_config('app._sig', v_expired_sig, true);

    v_result := connect_auth.current_user_id();
    IF v_result IS NOT NULL THEN
        RAISE EXCEPTION 'VULNERABILITY DETECTED: Expired context accepted!';
    END IF;

    RAISE NOTICE '✓ [BLOCKED] Attack 6 Neutralized: Expired context timestamp rejected.';
END $$;

-- ------------------------------------------------------------------------------
-- Attack Scenario 7: Unauthorized Organization Impersonation
-- ------------------------------------------------------------------------------
DO $$
DECLARE
    v_test_user_id UUID := gen_random_uuid();
    v_test_token_hash VARCHAR(64) := 'test_token_hash_scenario_7_abcdef0123456789abcdef0123456789abcdef';
    v_org_unauthorized UUID := gen_random_uuid();
BEGIN
    RAISE NOTICE 'Executing Attack Scenario 7: Unauthorized Org Membership Impersonation...';

    -- Insert active user and session
    INSERT INTO users (id, email, password_hash, status)
    VALUES (v_test_user_id, 'victim_scenario7@example.com', 'hash', 'active');

    INSERT INTO sessions (user_id, token_hash, expires_at)
    VALUES (v_test_user_id, v_test_token_hash, clock_timestamp() + INTERVAL '1 hour');

    -- Attempt to authenticate into an organization where the user has NO membership
    BEGIN
        PERFORM * FROM connect_auth.authenticate_session(
            v_test_token_hash,
            v_org_unauthorized
        );
        RAISE EXCEPTION 'VULNERABILITY DETECTED: User authenticated into organization without active membership!';
    EXCEPTION
        WHEN insufficient_privilege THEN
            RAISE NOTICE '✓ [BLOCKED] Attack 7 Neutralized: Unauthorized org request rejected with insufficient_privilege.';
    END;

    -- Cleanup test user and session
    DELETE FROM sessions WHERE token_hash = v_test_token_hash;
    DELETE FROM users WHERE id = v_test_user_id;
END $$;

RAISE NOTICE 'ALL 7 ADVERSARIAL ATTACK SCENARIOS SUCCESSFULLY DEFENDED AND VERIFIED!';
