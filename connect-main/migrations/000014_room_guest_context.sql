-- ==============================================================================
-- Migration: 000014_room_guest_context.sql
-- Guests have no session, so they cannot use authenticate_session. This gives them
-- a signed, transaction-local context limited to one room, so RLS can govern them.
-- Rollback: tests/sql/rollback_000014.sql
-- ==============================================================================

INSERT INTO schema_metadata (version, description)
VALUES ('000014_room_guest_context', 'Signed room guest context and participant file policies')
ON CONFLICT (version) DO NOTHING;

-- The API must verify the signed guest token first. Refuses user identities and non-participants.
CREATE OR REPLACE FUNCTION connect_auth.authenticate_room_guest(p_room_id UUID, p_identity TEXT)
RETURNS VOID
SECURITY DEFINER
SET search_path = pg_catalog, public, connect_auth
LANGUAGE plpgsql AS $$
DECLARE
    v_nonce TEXT := pg_catalog.encode(public.gen_random_bytes(16), 'hex');
    v_xid TEXT := pg_catalog.pg_current_xact_id()::TEXT;
    v_exp TEXT := EXTRACT(epoch FROM (pg_catalog.clock_timestamp() + INTERVAL '10 minutes'))::BIGINT::TEXT;
    v_secret BYTEA;
BEGIN
    IF p_identity LIKE 'user:%' OR connect_auth.room_access_role(p_room_id, p_identity) IS NULL THEN
        RAISE EXCEPTION 'guest has no access to this room' USING ERRCODE = 'insufficient_privilege';
    END IF;
    SELECT secret_key INTO v_secret FROM connect_auth.internal_keys WHERE id = 1;
    PERFORM pg_catalog.set_config('app._guest_room', p_room_id::TEXT, true);
    PERFORM pg_catalog.set_config('app._guest_identity', p_identity, true);
    PERFORM pg_catalog.set_config('app._guest_nonce', v_nonce, true);
    PERFORM pg_catalog.set_config('app._guest_xid', v_xid, true);
    PERFORM pg_catalog.set_config('app._guest_exp', v_exp, true);
    PERFORM pg_catalog.set_config('app._guest_sig', pg_catalog.encode(public.hmac(
        connect_auth.serialize_hmac_payload(p_room_id::TEXT, p_identity, 'guest', '', v_nonce, v_xid, v_exp)::BYTEA,
        v_secret, 'sha256'), 'hex'), true);
END;
$$;

REVOKE ALL ON FUNCTION connect_auth.authenticate_room_guest(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION connect_auth.authenticate_room_guest(UUID, TEXT) TO connect_app;

-- Fails closed: anything missing, forged, expired or from another transaction is invalid.
CREATE OR REPLACE FUNCTION connect_auth.guest_context_valid()
RETURNS BOOLEAN
SECURITY DEFINER
SET search_path = pg_catalog, public, connect_auth
LANGUAGE plpgsql STABLE AS $$
DECLARE
    v_room TEXT := NULLIF(pg_catalog.current_setting('app._guest_room', true), '');
    v_identity TEXT := NULLIF(pg_catalog.current_setting('app._guest_identity', true), '');
    v_nonce TEXT := NULLIF(pg_catalog.current_setting('app._guest_nonce', true), '');
    v_xid TEXT := NULLIF(pg_catalog.current_setting('app._guest_xid', true), '');
    v_exp TEXT := NULLIF(pg_catalog.current_setting('app._guest_exp', true), '');
    v_sig TEXT := NULLIF(pg_catalog.current_setting('app._guest_sig', true), '');
    v_secret BYTEA;
BEGIN
    IF v_room IS NULL OR v_identity IS NULL OR v_nonce IS NULL OR v_xid IS NULL OR v_exp IS NULL OR v_sig IS NULL THEN
        RETURN false;
    END IF;
    IF v_xid <> pg_catalog.pg_current_xact_id()::TEXT
       OR EXTRACT(epoch FROM pg_catalog.clock_timestamp()) > v_exp::BIGINT THEN
        RETURN false;
    END IF;
    SELECT secret_key INTO v_secret FROM connect_auth.internal_keys WHERE id = 1;
    RETURN connect_auth.constant_time_equals(v_sig, pg_catalog.encode(public.hmac(
        connect_auth.serialize_hmac_payload(v_room, v_identity, 'guest', '', v_nonce, v_xid, v_exp)::BYTEA,
        v_secret, 'sha256'), 'hex'));
END;
$$;

CREATE OR REPLACE FUNCTION connect_auth.current_guest_room()
RETURNS UUID
SECURITY DEFINER
SET search_path = pg_catalog, public, connect_auth
LANGUAGE sql STABLE AS $$
    SELECT CASE WHEN connect_auth.guest_context_valid()
        THEN pg_catalog.current_setting('app._guest_room', true)::UUID END
$$;

CREATE OR REPLACE FUNCTION connect_auth.current_guest_identity()
RETURNS TEXT
SECURITY DEFINER
SET search_path = pg_catalog, public, connect_auth
LANGUAGE sql STABLE AS $$
    SELECT CASE WHEN connect_auth.guest_context_valid()
        THEN pg_catalog.current_setting('app._guest_identity', true) END
$$;

CREATE OR REPLACE FUNCTION connect_auth.is_room_host(p_room_id UUID)
RETURNS BOOLEAN
SECURITY DEFINER
SET search_path = pg_catalog, public, connect_auth
LANGUAGE sql STABLE AS $$
    SELECT connect_auth.current_user_id() IS NOT NULL
       AND connect_auth.room_access_role(p_room_id, 'user:' || connect_auth.current_user_id()::TEXT) = 'host'
$$;

REVOKE ALL ON FUNCTION connect_auth.guest_context_valid() FROM PUBLIC;
REVOKE ALL ON FUNCTION connect_auth.current_guest_room() FROM PUBLIC;
REVOKE ALL ON FUNCTION connect_auth.current_guest_identity() FROM PUBLIC;
REVOKE ALL ON FUNCTION connect_auth.is_room_host(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION connect_auth.current_guest_room() TO connect_app, connect_worker;
GRANT EXECUTE ON FUNCTION connect_auth.current_guest_identity() TO connect_app, connect_worker;
GRANT EXECUTE ON FUNCTION connect_auth.is_room_host(UUID) TO connect_app, connect_worker;

-- Room files: participants read, uploaders and hosts change. Mirrors the service rules.
CREATE POLICY rls_files_member_select ON meeting_files
    AS PERMISSIVE FOR SELECT
    USING (connect_auth.is_room_member(room_id) OR room_id = connect_auth.current_guest_room());

CREATE POLICY rls_files_member_insert ON meeting_files
    AS PERMISSIVE FOR INSERT
    WITH CHECK (
        (uploaded_by = connect_auth.current_user_id() AND connect_auth.is_room_member(room_id))
        OR (
            uploaded_by IS NULL
            AND room_id = connect_auth.current_guest_room()
            AND uploaded_by_identity = connect_auth.current_guest_identity()
        )
    );

CREATE POLICY rls_files_member_update ON meeting_files
    AS PERMISSIVE FOR UPDATE
    USING (
        connect_auth.is_room_host(room_id)
        OR (connect_auth.is_room_member(room_id) AND uploaded_by = connect_auth.current_user_id())
        OR (room_id = connect_auth.current_guest_room() AND uploaded_by_identity = connect_auth.current_guest_identity())
    )
    WITH CHECK (
        connect_auth.is_room_member(room_id) OR room_id = connect_auth.current_guest_room()
    );
