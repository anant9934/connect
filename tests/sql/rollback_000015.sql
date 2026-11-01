-- Reverses migration 000015 on a disposable database during verification.
DROP POLICY IF EXISTS rls_rooms_worker_update ON rooms;
DROP POLICY IF EXISTS rls_rooms_host_update ON rooms;
DROP POLICY IF EXISTS rls_rooms_member_select ON rooms;
DROP POLICY IF EXISTS rls_participant_locks_worker ON participant_locks;
DROP POLICY IF EXISTS rls_participant_locks_host ON participant_locks;
DROP POLICY IF EXISTS rls_admissions_worker ON room_admissions;
DROP POLICY IF EXISTS rls_admissions_update ON room_admissions;
DROP POLICY IF EXISTS rls_admissions_insert ON room_admissions;
DROP POLICY IF EXISTS rls_admissions_select ON room_admissions;
DROP TRIGGER IF EXISTS trg_guard_participant_update ON room_participants;
DROP FUNCTION IF EXISTS connect_auth.guard_participant_update();
DROP POLICY IF EXISTS rls_participants_update ON room_participants;
DROP POLICY IF EXISTS rls_participants_insert ON room_participants;
DROP POLICY IF EXISTS rls_participants_select ON room_participants;
ALTER TABLE room_invites NO FORCE ROW LEVEL SECURITY;
ALTER TABLE room_invites DISABLE ROW LEVEL SECURITY;
ALTER TABLE participant_locks NO FORCE ROW LEVEL SECURITY;
ALTER TABLE participant_locks DISABLE ROW LEVEL SECURITY;
ALTER TABLE room_admissions NO FORCE ROW LEVEL SECURITY;
ALTER TABLE room_admissions DISABLE ROW LEVEL SECURITY;
ALTER TABLE room_participants NO FORCE ROW LEVEL SECURITY;
ALTER TABLE room_participants DISABLE ROW LEVEL SECURITY;
DROP FUNCTION IF EXISTS connect_auth.guest_admission(UUID, TEXT);
DROP FUNCTION IF EXISTS connect_auth.guest_request_admission(UUID, UUID, TEXT, TEXT, TEXT, TIMESTAMPTZ);
DROP FUNCTION IF EXISTS connect_auth.guest_leave_room(UUID, TEXT, TIMESTAMPTZ);
DROP FUNCTION IF EXISTS connect_auth.guest_join_room(UUID, UUID, TEXT, TEXT, TIMESTAMPTZ);
DROP FUNCTION IF EXISTS connect_auth.participant_removed(UUID, TEXT);
DROP FUNCTION IF EXISTS connect_auth.room_active_count(UUID);
DROP FUNCTION IF EXISTS connect_auth.room_by_code(TEXT);

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

DROP FUNCTION IF EXISTS connect_auth.can_enter_room(UUID, TEXT);
DELETE FROM schema_metadata WHERE version = '000015_room_rls_and_entry_rules';
