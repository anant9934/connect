-- Reverses migration 000018 on a disposable database during verification.
DROP TRIGGER IF EXISTS trg_guard_room_update ON rooms;
DROP FUNCTION IF EXISTS connect_auth.guard_room_update();
DROP POLICY IF EXISTS rls_rooms_moderator_update ON rooms;
DROP POLICY IF EXISTS rls_participant_locks_moderator ON participant_locks;
DROP POLICY IF EXISTS rls_admissions_moderator_update ON room_admissions;
DROP POLICY IF EXISTS rls_admissions_moderator_select ON room_admissions;
DROP POLICY IF EXISTS rls_participants_moderate ON room_participants;

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

DROP FUNCTION IF EXISTS connect_auth.room_by_code(TEXT);

CREATE FUNCTION connect_auth.room_by_code(p_code TEXT)
RETURNS TABLE (
    id UUID, public_code VARCHAR, host_user_id UUID, status VARCHAR, is_locked BOOLEAN,
    waiting_room_enabled BOOLEAN, max_participants INT, created_at TIMESTAMPTZ,
    started_at TIMESTAMPTZ, ended_at TIMESTAMPTZ, locked_at TIMESTAMPTZ,
    title VARCHAR, scheduled_start TIMESTAMPTZ, scheduled_end TIMESTAMPTZ, time_zone VARCHAR, passcode_hash TEXT
)
SECURITY DEFINER
SET search_path = pg_catalog, public, connect_auth
LANGUAGE sql STABLE AS $$
    SELECT r.id, r.public_code, r.host_user_id, r.status, r.is_locked, r.waiting_room_enabled,
           r.max_participants, r.created_at, r.started_at, r.ended_at, r.locked_at,
           r.title, r.scheduled_start, r.scheduled_end, r.time_zone, r.passcode_hash
    FROM public.rooms r WHERE r.public_code = p_code
$$;

REVOKE ALL ON FUNCTION connect_auth.room_by_code(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION connect_auth.room_by_code(TEXT) TO connect_app;

DROP FUNCTION IF EXISTS connect_auth.enqueue_host_succession(UUID, TEXT, INT);
DROP FUNCTION IF EXISTS connect_auth.succeed_room_host(UUID);
DROP FUNCTION IF EXISTS connect_auth.is_participant_connected(UUID, TEXT);
DROP FUNCTION IF EXISTS connect_auth.transfer_room_host(UUID, TEXT);
DROP FUNCTION IF EXISTS connect_auth.apply_host_change(UUID, UUID, TEXT);
DROP FUNCTION IF EXISTS connect_auth.set_cohost(UUID, TEXT, BOOLEAN);
DROP FUNCTION IF EXISTS connect_auth.is_room_moderator(UUID, TEXT);

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

ALTER TABLE rooms DROP COLUMN IF EXISTS participants_can_publish;
ALTER TABLE rooms DROP COLUMN IF EXISTS cohost_permissions;
DELETE FROM schema_metadata WHERE version = '000018_cohost_and_host_transfer';
