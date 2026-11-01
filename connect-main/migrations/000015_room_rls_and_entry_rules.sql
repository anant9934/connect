-- ==============================================================================
-- Migration: 000015_room_rls_and_entry_rules.sql
-- room_participants, room_admissions, participant_locks and room_invites had no RLS.
-- Entry rules move into one function so notes, files and rooms share them: institutional
-- rooms require active membership and refuse guests; a waiting room requires admission.
-- Rollback: tests/sql/rollback_000015.sql
-- ==============================================================================

INSERT INTO schema_metadata (version, description)
VALUES ('000015_room_rls_and_entry_rules', 'RLS on room participant tables and shared room entry rules')
ON CONFLICT (version) DO NOTHING;

CREATE OR REPLACE FUNCTION connect_auth.can_enter_room(p_room_id UUID, p_identity TEXT)
RETURNS BOOLEAN
SECURITY DEFINER
SET search_path = pg_catalog, public, connect_auth
LANGUAGE plpgsql STABLE AS $$
DECLARE
    v_workspace TEXT;
    v_org UUID;
BEGIN
    SELECT r.workspace_type, r.organization_id INTO v_workspace, v_org
    FROM public.rooms r WHERE r.id = p_room_id;
    IF NOT FOUND THEN
        RETURN false;
    END IF;
    IF v_workspace IS DISTINCT FROM 'institutional' THEN
        RETURN true;
    END IF;
    RETURN p_identity LIKE 'user:%' AND EXISTS (
        SELECT 1 FROM public.organization_memberships om
        WHERE om.organization_id = v_org
          AND 'user:' || om.user_id::TEXT = p_identity
          AND om.status = 'active'
    );
END;
$$;

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
    IF NOT connect_auth.can_enter_room(p_room_id, p_identity) THEN
        RETURN NULL;
    END IF;

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

    -- Joining registers a participant before the host decides, so registration alone is not access.
    IF EXISTS (SELECT 1 FROM public.rooms r WHERE r.id = p_room_id AND r.waiting_room_enabled)
       AND NOT EXISTS (
           SELECT 1 FROM public.room_admissions a
           WHERE a.room_id = p_room_id AND a.identity = p_identity AND a.status = 'admitted'
       ) THEN
        RETURN NULL;
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

REVOKE ALL ON FUNCTION connect_auth.can_enter_room(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION connect_auth.can_enter_room(UUID, TEXT) TO connect_app;

-- A public code is a capability, so anyone holding one may read this limited metadata.
CREATE OR REPLACE FUNCTION connect_auth.room_by_code(p_code TEXT)
RETURNS TABLE (
    id UUID, public_code VARCHAR, host_user_id UUID, status VARCHAR, is_locked BOOLEAN,
    waiting_room_enabled BOOLEAN, max_participants INT, created_at TIMESTAMPTZ,
    started_at TIMESTAMPTZ, ended_at TIMESTAMPTZ, locked_at TIMESTAMPTZ
)
SECURITY DEFINER
SET search_path = pg_catalog, public, connect_auth
LANGUAGE sql STABLE AS $$
    SELECT r.id, r.public_code, r.host_user_id, r.status, r.is_locked, r.waiting_room_enabled,
           r.max_participants, r.created_at, r.started_at, r.ended_at, r.locked_at
    FROM public.rooms r WHERE r.public_code = p_code
$$;

CREATE OR REPLACE FUNCTION connect_auth.room_active_count(p_room_id UUID)
RETURNS INT
SECURITY DEFINER
SET search_path = pg_catalog, public, connect_auth
LANGUAGE sql STABLE AS $$
    SELECT count(*)::INT FROM public.room_participants rp
    WHERE rp.room_id = p_room_id AND rp.left_at IS NULL
$$;

CREATE OR REPLACE FUNCTION connect_auth.participant_removed(p_room_id UUID, p_identity TEXT)
RETURNS BOOLEAN
SECURITY DEFINER
SET search_path = pg_catalog, public, connect_auth
LANGUAGE sql STABLE AS $$
    SELECT COALESCE((
        SELECT rp.is_removed FROM public.room_participants rp
        WHERE rp.room_id = p_room_id AND rp.identity = p_identity
        ORDER BY rp.joined_at DESC LIMIT 1
    ), false)
$$;

-- Guest functions: the API has verified or just minted the identity. User identities are refused.
CREATE OR REPLACE FUNCTION connect_auth.guest_join_room(
    p_id UUID, p_room_id UUID, p_identity TEXT, p_display_name TEXT, p_joined_at TIMESTAMPTZ
)
RETURNS VOID
SECURITY DEFINER
SET search_path = pg_catalog, public, connect_auth
LANGUAGE plpgsql AS $$
BEGIN
    IF p_identity NOT LIKE 'guest:%'
       OR NOT connect_auth.can_enter_room(p_room_id, p_identity)
       OR connect_auth.participant_removed(p_room_id, p_identity)
       OR EXISTS (SELECT 1 FROM public.rooms r WHERE r.id = p_room_id AND r.status = 'ended') THEN
        RAISE EXCEPTION 'guest may not join this room' USING ERRCODE = 'insufficient_privilege';
    END IF;
    INSERT INTO public.room_participants (id, room_id, identity, display_name, role, is_guest, joined_at, transition_state)
    VALUES (p_id, p_room_id, p_identity, p_display_name, 'participant', true, p_joined_at, 'idle');
END;
$$;

CREATE OR REPLACE FUNCTION connect_auth.guest_leave_room(p_room_id UUID, p_identity TEXT, p_left_at TIMESTAMPTZ)
RETURNS VOID
SECURITY DEFINER
SET search_path = pg_catalog, public, connect_auth
LANGUAGE plpgsql AS $$
BEGIN
    IF p_identity NOT LIKE 'guest:%' THEN
        RAISE EXCEPTION 'not a guest identity' USING ERRCODE = 'insufficient_privilege';
    END IF;
    UPDATE public.room_participants rp SET left_at = p_left_at
    WHERE rp.room_id = p_room_id AND rp.identity = p_identity AND rp.left_at IS NULL;
END;
$$;

CREATE OR REPLACE FUNCTION connect_auth.guest_request_admission(
    p_id UUID, p_room_id UUID, p_identity TEXT, p_display_name TEXT, p_status TEXT, p_requested_at TIMESTAMPTZ
)
RETURNS VOID
SECURITY DEFINER
SET search_path = pg_catalog, public, connect_auth
LANGUAGE plpgsql AS $$
BEGIN
    IF p_identity NOT LIKE 'guest:%' OR p_status <> 'pending'
       OR NOT connect_auth.can_enter_room(p_room_id, p_identity) THEN
        RAISE EXCEPTION 'guest may not request admission' USING ERRCODE = 'insufficient_privilege';
    END IF;
    INSERT INTO public.room_admissions (id, room_id, identity, display_name, status, requested_at)
    VALUES (p_id, p_room_id, p_identity, p_display_name, p_status, p_requested_at);
END;
$$;

CREATE OR REPLACE FUNCTION connect_auth.guest_admission(p_room_id UUID, p_identity TEXT)
RETURNS TABLE (
    id UUID, room_id UUID, identity VARCHAR, display_name VARCHAR, status VARCHAR,
    requested_at TIMESTAMPTZ, decided_at TIMESTAMPTZ
)
SECURITY DEFINER
SET search_path = pg_catalog, public, connect_auth
LANGUAGE sql STABLE AS $$
    SELECT a.id, a.room_id, a.identity, a.display_name, a.status, a.requested_at, a.decided_at
    FROM public.room_admissions a
    WHERE a.room_id = p_room_id AND a.identity = p_identity AND p_identity LIKE 'guest:%'
    ORDER BY a.requested_at DESC LIMIT 1
$$;

REVOKE ALL ON FUNCTION connect_auth.room_by_code(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION connect_auth.room_active_count(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION connect_auth.participant_removed(UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION connect_auth.guest_join_room(UUID, UUID, TEXT, TEXT, TIMESTAMPTZ) FROM PUBLIC;
REVOKE ALL ON FUNCTION connect_auth.guest_leave_room(UUID, TEXT, TIMESTAMPTZ) FROM PUBLIC;
REVOKE ALL ON FUNCTION connect_auth.guest_request_admission(UUID, UUID, TEXT, TEXT, TEXT, TIMESTAMPTZ) FROM PUBLIC;
REVOKE ALL ON FUNCTION connect_auth.guest_admission(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION connect_auth.room_by_code(TEXT) TO connect_app;
GRANT EXECUTE ON FUNCTION connect_auth.room_active_count(UUID) TO connect_app;
GRANT EXECUTE ON FUNCTION connect_auth.participant_removed(UUID, TEXT) TO connect_app;
GRANT EXECUTE ON FUNCTION connect_auth.guest_join_room(UUID, UUID, TEXT, TEXT, TIMESTAMPTZ) TO connect_app;
GRANT EXECUTE ON FUNCTION connect_auth.guest_leave_room(UUID, TEXT, TIMESTAMPTZ) TO connect_app;
GRANT EXECUTE ON FUNCTION connect_auth.guest_request_admission(UUID, UUID, TEXT, TEXT, TEXT, TIMESTAMPTZ) TO connect_app;
GRANT EXECUTE ON FUNCTION connect_auth.guest_admission(UUID, TEXT) TO connect_app;

ALTER TABLE room_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE room_participants FORCE ROW LEVEL SECURITY;
ALTER TABLE room_admissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE room_admissions FORCE ROW LEVEL SECURITY;
ALTER TABLE participant_locks ENABLE ROW LEVEL SECURITY;
ALTER TABLE participant_locks FORCE ROW LEVEL SECURITY;
-- Unused by the application, so no policy: closed to the runtime roles.
ALTER TABLE room_invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE room_invites FORCE ROW LEVEL SECURITY;

CREATE POLICY rls_participants_select ON room_participants
    FOR SELECT USING (
        connect_auth.is_super_admin()
        OR identity = 'user:' || connect_auth.current_user_id()::TEXT
        OR connect_auth.is_room_member(room_id)
        OR room_id = connect_auth.current_guest_room()
    );

CREATE POLICY rls_participants_insert ON room_participants
    FOR INSERT WITH CHECK (
        user_id = connect_auth.current_user_id()
        AND identity = 'user:' || connect_auth.current_user_id()::TEXT
        AND NOT is_guest
        AND connect_auth.can_enter_room(room_id, identity)
        AND NOT connect_auth.participant_removed(room_id, identity)
        AND (role = 'participant' OR connect_auth.is_room_host(room_id))
    );

CREATE POLICY rls_participants_update ON room_participants
    FOR UPDATE
    USING (identity = 'user:' || connect_auth.current_user_id()::TEXT OR connect_auth.is_room_host(room_id))
    WITH CHECK (identity = 'user:' || connect_auth.current_user_id()::TEXT OR connect_auth.is_room_host(room_id));

-- RLS cannot compare old and new values, so a participant updating their own row
-- (to leave) is stopped from changing anything that carries authority.
CREATE OR REPLACE FUNCTION connect_auth.guard_participant_update()
RETURNS TRIGGER
SET search_path = pg_catalog, public, connect_auth
LANGUAGE plpgsql AS $$
BEGIN
    IF CURRENT_USER = 'connect_app' AND NOT connect_auth.is_room_host(OLD.room_id) AND (
        NEW.role IS DISTINCT FROM OLD.role
        OR NEW.is_removed IS DISTINCT FROM OLD.is_removed
        OR NEW.identity IS DISTINCT FROM OLD.identity
        OR NEW.user_id IS DISTINCT FROM OLD.user_id
        OR NEW.room_id IS DISTINCT FROM OLD.room_id
        OR NEW.is_guest IS DISTINCT FROM OLD.is_guest
        OR NEW.fencing_token IS DISTINCT FROM OLD.fencing_token
        OR NEW.transition_state IS DISTINCT FROM OLD.transition_state
    ) THEN
        RAISE EXCEPTION 'only the host may change participant authority' USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_guard_participant_update BEFORE UPDATE ON room_participants
    FOR EACH ROW EXECUTE FUNCTION connect_auth.guard_participant_update();

GRANT EXECUTE ON FUNCTION connect_auth.guard_participant_update() TO connect_app, connect_worker;

CREATE POLICY rls_admissions_select ON room_admissions
    FOR SELECT USING (
        connect_auth.is_super_admin()
        OR identity = 'user:' || connect_auth.current_user_id()::TEXT
        OR connect_auth.is_room_host(room_id)
    );

CREATE POLICY rls_admissions_insert ON room_admissions
    FOR INSERT WITH CHECK (
        identity = 'user:' || connect_auth.current_user_id()::TEXT
        AND status = 'pending'
        AND connect_auth.can_enter_room(room_id, identity)
    );

CREATE POLICY rls_admissions_update ON room_admissions
    FOR UPDATE USING (connect_auth.is_room_host(room_id)) WITH CHECK (connect_auth.is_room_host(room_id));

CREATE POLICY rls_admissions_worker ON room_admissions
    FOR ALL TO connect_worker USING (true) WITH CHECK (true);

-- Lock keys are room_id:identity. Only hosts change roles, so only they take locks.
CREATE POLICY rls_participant_locks_host ON participant_locks
    USING (connect_auth.is_room_host(
        CASE WHEN split_part(lock_key, ':', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
             THEN split_part(lock_key, ':', 1)::UUID END))
    WITH CHECK (connect_auth.is_room_host(
        CASE WHEN split_part(lock_key, ':', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
             THEN split_part(lock_key, ':', 1)::UUID END));

CREATE POLICY rls_participant_locks_worker ON participant_locks
    FOR ALL TO connect_worker USING (true) WITH CHECK (true);

-- Hosts and members act without an organization in context; access is decided by the room rules.
CREATE POLICY rls_rooms_member_select ON rooms
    FOR SELECT USING (connect_auth.is_room_member(id));

CREATE POLICY rls_rooms_host_update ON rooms
    FOR UPDATE USING (connect_auth.is_room_host(id)) WITH CHECK (connect_auth.is_room_host(id));

-- The worker's cleanup job ends rooms, which the select-only policy from 000011 blocked.
CREATE POLICY rls_rooms_worker_update ON rooms
    FOR UPDATE TO connect_worker USING (true) WITH CHECK (true);
