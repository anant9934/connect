-- ==============================================================================
-- Migration: 000013_room_participant_access.sql
-- Meeting notes are collaborative: being in the room is what grants access. The
-- creator-only policies from 000008 would break that once the API runs under RLS.
-- Guests have no session, so they reach notes only through narrow functions.
-- Rollback: tests/sql/rollback_000013.sql
-- ==============================================================================

INSERT INTO schema_metadata (version, description)
VALUES ('000013_room_participant_access', 'Room participant access resolver and collaborative note policies')
ON CONFLICT (version) DO NOTHING;

-- NULL means no access. Not granted to any role: only other definer functions call it.
CREATE OR REPLACE FUNCTION connect_auth.room_access_role(p_room_id UUID, p_identity TEXT)
RETURNS TEXT
SECURITY DEFINER
SET search_path = pg_catalog, public, connect_auth
LANGUAGE plpgsql STABLE AS $$
DECLARE
    v_removed BOOLEAN;
    v_role TEXT;
    v_is_guest BOOLEAN;
BEGIN
    SELECT rp.is_removed INTO v_removed
    FROM public.room_participants rp
    WHERE rp.room_id = p_room_id AND rp.identity = p_identity
    ORDER BY rp.joined_at DESC
    LIMIT 1;
    IF v_removed THEN
        RETURN NULL;
    END IF;

    IF EXISTS (
        SELECT 1 FROM public.rooms r
        WHERE r.id = p_room_id AND 'user:' || r.host_user_id::TEXT = p_identity
    ) THEN
        RETURN 'host';
    END IF;

    SELECT rp.role, rp.is_guest INTO v_role, v_is_guest
    FROM public.room_participants rp
    WHERE rp.room_id = p_room_id AND rp.identity = p_identity AND rp.left_at IS NULL
    ORDER BY rp.joined_at DESC
    LIMIT 1;
    IF v_role IS NULL THEN
        RETURN NULL;
    END IF;
    -- A guest can never hold host authority.
    RETURN CASE WHEN v_role = 'host' AND NOT v_is_guest THEN 'host' ELSE 'participant' END;
END;
$$;

REVOKE ALL ON FUNCTION connect_auth.room_access_role(UUID, TEXT) FROM PUBLIC;

-- The identity must already be verified by the API, from a session or a signed guest token.
CREATE OR REPLACE FUNCTION connect_auth.resolve_room_access(p_code TEXT, p_identity TEXT)
RETURNS TABLE (room_id UUID, is_host BOOLEAN)
SECURITY DEFINER
SET search_path = pg_catalog, public, connect_auth
LANGUAGE plpgsql STABLE AS $$
DECLARE
    v_room_id UUID;
    v_role TEXT;
BEGIN
    SELECT r.id INTO v_room_id FROM public.rooms r WHERE r.public_code = p_code;
    IF v_room_id IS NULL THEN
        RETURN;
    END IF;
    v_role := connect_auth.room_access_role(v_room_id, p_identity);
    IF v_role IS NOT NULL THEN
        room_id := v_room_id;
        is_host := v_role = 'host';
        RETURN NEXT;
    END IF;
END;
$$;

REVOKE ALL ON FUNCTION connect_auth.resolve_room_access(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION connect_auth.resolve_room_access(TEXT, TEXT) TO connect_app;

CREATE OR REPLACE FUNCTION connect_auth.is_room_member(p_room_id UUID)
RETURNS BOOLEAN
SECURITY DEFINER
SET search_path = pg_catalog, public, connect_auth
LANGUAGE sql STABLE AS $$
    SELECT connect_auth.current_user_id() IS NOT NULL
       AND connect_auth.room_access_role(p_room_id, 'user:' || connect_auth.current_user_id()::TEXT) IS NOT NULL
$$;

REVOKE ALL ON FUNCTION connect_auth.is_room_member(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION connect_auth.is_room_member(UUID) TO connect_app, connect_worker;

CREATE POLICY rls_notes_member_select ON meeting_notes
    AS PERMISSIVE FOR SELECT
    USING (connect_auth.is_room_member(room_id));

CREATE POLICY rls_notes_member_insert ON meeting_notes
    AS PERMISSIVE FOR INSERT
    WITH CHECK (created_by = connect_auth.current_user_id() AND connect_auth.is_room_member(room_id));

CREATE POLICY rls_notes_member_update ON meeting_notes
    AS PERMISSIVE FOR UPDATE
    USING (connect_auth.is_room_member(room_id))
    WITH CHECK (connect_auth.is_room_member(room_id));

-- Guest functions refuse user identities, so they cannot bypass session authentication.
CREATE OR REPLACE FUNCTION connect_auth.guest_read_note(p_room_id UUID, p_identity TEXT)
RETURNS SETOF public.meeting_notes
SECURITY DEFINER
SET search_path = pg_catalog, public, connect_auth
LANGUAGE plpgsql STABLE AS $$
BEGIN
    IF p_identity LIKE 'user:%' OR connect_auth.room_access_role(p_room_id, p_identity) IS NULL THEN
        RAISE EXCEPTION 'guest has no access to this room' USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN QUERY SELECT n.* FROM public.meeting_notes n WHERE n.room_id = p_room_id;
END;
$$;

REVOKE ALL ON FUNCTION connect_auth.guest_read_note(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION connect_auth.guest_read_note(UUID, TEXT) TO connect_app;

-- SQLSTATE CN409 reports a stale revision to the caller.
CREATE OR REPLACE FUNCTION connect_auth.guest_upsert_note(
    p_room_id UUID, p_identity TEXT, p_title TEXT, p_content TEXT, p_expected_revision INT
)
RETURNS SETOF public.meeting_notes
SECURITY DEFINER
SET search_path = pg_catalog, public, connect_auth
LANGUAGE plpgsql AS $$
DECLARE
    v_revision INT;
BEGIN
    IF p_identity LIKE 'user:%' OR connect_auth.room_access_role(p_room_id, p_identity) IS NULL THEN
        RAISE EXCEPTION 'guest has no access to this room' USING ERRCODE = 'insufficient_privilege';
    END IF;

    SELECT n.revision INTO v_revision FROM public.meeting_notes n WHERE n.room_id = p_room_id FOR UPDATE;
    IF v_revision IS NULL THEN
        IF p_expected_revision NOT IN (0, 1) THEN
            RAISE EXCEPTION 'stale note revision' USING ERRCODE = 'CN409';
        END IF;
        RETURN QUERY
        INSERT INTO public.meeting_notes (room_id, title, content, revision, created_by_identity, updated_by_identity)
        VALUES (p_room_id, p_title, p_content, CASE WHEN p_expected_revision = 0 THEN 1 ELSE 2 END, p_identity, p_identity)
        RETURNING *;
        RETURN;
    END IF;

    IF v_revision <> p_expected_revision THEN
        RAISE EXCEPTION 'stale note revision' USING ERRCODE = 'CN409';
    END IF;
    RETURN QUERY
    UPDATE public.meeting_notes n
    SET title = p_title, content = p_content, revision = n.revision + 1,
        updated_by_identity = p_identity, updated_at = pg_catalog.clock_timestamp()
    WHERE n.room_id = p_room_id
    RETURNING n.*;
END;
$$;

REVOKE ALL ON FUNCTION connect_auth.guest_upsert_note(UUID, TEXT, TEXT, TEXT, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION connect_auth.guest_upsert_note(UUID, TEXT, TEXT, TEXT, INT) TO connect_app;
