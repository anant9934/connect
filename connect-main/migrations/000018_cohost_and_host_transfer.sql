-- ==============================================================================
-- Migration: 000018_cohost_and_host_transfer.sql
-- Co-hosts hold configurable moderation rights. Ownership moves only through functions that
-- lock the room, so there is always exactly one host, even under concurrent requests.
-- Rollback: tests/sql/rollback_000018.sql
-- ==============================================================================

INSERT INTO schema_metadata (version, description)
VALUES ('000018_cohost_and_host_transfer', 'Co-host permissions, atomic host transfer and host succession')
ON CONFLICT (version) DO NOTHING;

ALTER TABLE rooms ADD COLUMN IF NOT EXISTS cohost_permissions JSONB NOT NULL
    DEFAULT '{"admit": true, "mute": true, "remove": true, "lock": true, "speakers": true}'::jsonb;

-- Whether regular participants may publish. A classroom can turn this off and promote speakers.
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS participants_can_publish BOOLEAN NOT NULL DEFAULT true;

-- Only rooms.host_user_id makes someone host; a stale participant role no longer does.
CREATE OR REPLACE FUNCTION connect_auth.room_access_role(p_room_id UUID, p_identity TEXT)
RETURNS TEXT
SECURITY DEFINER
SET search_path = pg_catalog, public, connect_auth
LANGUAGE plpgsql STABLE AS $$
DECLARE
    v_removed BOOLEAN;
    v_role TEXT;
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

    SELECT rp.role INTO v_role
    FROM public.room_participants rp
    WHERE rp.room_id = p_room_id AND rp.identity = p_identity AND rp.left_at IS NULL
    ORDER BY rp.joined_at DESC
    LIMIT 1;
    IF v_role IS NULL THEN
        RETURN NULL;
    END IF;
    RETURN CASE WHEN v_role = 'co-host' THEN 'co-host' ELSE 'participant' END;
END;
$$;

CREATE OR REPLACE FUNCTION connect_auth.is_room_moderator(p_room_id UUID, p_permission TEXT)
RETURNS BOOLEAN
SECURITY DEFINER
SET search_path = pg_catalog, public, connect_auth
LANGUAGE plpgsql STABLE AS $$
DECLARE
    v_role TEXT;
BEGIN
    IF connect_auth.current_user_id() IS NULL THEN
        RETURN false;
    END IF;
    v_role := connect_auth.room_access_role(p_room_id, 'user:' || connect_auth.current_user_id()::TEXT);
    IF v_role = 'host' THEN
        RETURN true;
    END IF;
    RETURN v_role = 'co-host' AND EXISTS (
        SELECT 1 FROM public.rooms r
        WHERE r.id = p_room_id AND COALESCE((r.cohost_permissions ->> p_permission)::BOOLEAN, false)
    );
END;
$$;

REVOKE ALL ON FUNCTION connect_auth.is_room_moderator(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION connect_auth.is_room_moderator(UUID, TEXT) TO connect_app, connect_worker;

-- SQLSTATE CN404: no such active participant. CN422: the target is not eligible.
CREATE OR REPLACE FUNCTION connect_auth.set_cohost(p_room_id UUID, p_identity TEXT, p_grant BOOLEAN)
RETURNS VOID
SECURITY DEFINER
SET search_path = pg_catalog, public, connect_auth
LANGUAGE plpgsql AS $$
DECLARE
    v_host UUID;
BEGIN
    SELECT r.host_user_id INTO v_host FROM public.rooms r WHERE r.id = p_room_id FOR UPDATE;
    IF v_host IS NULL OR v_host IS DISTINCT FROM connect_auth.current_user_id() THEN
        RAISE EXCEPTION 'only the host may change co-hosts' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF p_identity = 'user:' || v_host::TEXT THEN
        RAISE EXCEPTION 'the host cannot be a co-host' USING ERRCODE = 'CN422';
    END IF;
    IF p_grant AND p_identity NOT LIKE 'user:%' THEN
        RAISE EXCEPTION 'guests cannot be co-hosts' USING ERRCODE = 'CN422';
    END IF;
    IF connect_auth.room_access_role(p_room_id, p_identity) IS NULL THEN
        RAISE EXCEPTION 'participant not found in this room' USING ERRCODE = 'CN404';
    END IF;
    UPDATE public.room_participants rp
    SET role = CASE WHEN p_grant THEN 'co-host' ELSE 'participant' END,
        transition_state = 'idle', transition_op_id = ''
    WHERE rp.room_id = p_room_id AND rp.identity = p_identity AND rp.left_at IS NULL
      AND (p_grant OR rp.role = 'co-host');
END;
$$;

REVOKE ALL ON FUNCTION connect_auth.set_cohost(UUID, TEXT, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION connect_auth.set_cohost(UUID, TEXT, BOOLEAN) TO connect_app;

-- Shared by transfer and succession. The caller must already hold the room row lock.
CREATE OR REPLACE FUNCTION connect_auth.apply_host_change(p_room_id UUID, p_old_host UUID, p_new_identity TEXT)
RETURNS VOID
SECURITY DEFINER
SET search_path = pg_catalog, public, connect_auth
LANGUAGE plpgsql AS $$
BEGIN
    UPDATE public.rooms SET host_user_id = substr(p_new_identity, 6)::UUID WHERE id = p_room_id;
    UPDATE public.room_participants rp SET role = 'participant', transition_state = 'idle', transition_op_id = ''
    WHERE rp.room_id = p_room_id AND rp.identity = 'user:' || p_old_host::TEXT AND rp.left_at IS NULL;
    UPDATE public.room_participants rp SET role = 'host', transition_state = 'idle', transition_op_id = ''
    WHERE rp.room_id = p_room_id AND rp.identity = p_new_identity AND rp.left_at IS NULL;
END;
$$;

REVOKE ALL ON FUNCTION connect_auth.apply_host_change(UUID, UUID, TEXT) FROM PUBLIC;

-- Takes effect immediately, so a new host cannot decline. They can transfer it back or leave,
-- and leaving follows the same succession rule as any other host.
CREATE OR REPLACE FUNCTION connect_auth.transfer_room_host(p_room_id UUID, p_identity TEXT)
RETURNS VOID
SECURITY DEFINER
SET search_path = pg_catalog, public, connect_auth
LANGUAGE plpgsql AS $$
DECLARE
    v_host UUID;
    v_status TEXT;
BEGIN
    SELECT r.host_user_id, r.status INTO v_host, v_status FROM public.rooms r WHERE r.id = p_room_id FOR UPDATE;
    IF v_host IS NULL OR v_host IS DISTINCT FROM connect_auth.current_user_id() THEN
        RAISE EXCEPTION 'only the host may transfer the meeting' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF v_status <> 'active' THEN
        RAISE EXCEPTION 'only a running meeting can be transferred' USING ERRCODE = 'CN422';
    END IF;
    IF p_identity NOT LIKE 'user:%' OR p_identity = 'user:' || v_host::TEXT THEN
        RAISE EXCEPTION 'the target cannot become host' USING ERRCODE = 'CN422';
    END IF;
    IF connect_auth.room_access_role(p_room_id, p_identity) IS NULL THEN
        RAISE EXCEPTION 'participant not found in this room' USING ERRCODE = 'CN404';
    END IF;
    PERFORM connect_auth.apply_host_change(p_room_id, v_host, p_identity);
END;
$$;

REVOKE ALL ON FUNCTION connect_auth.transfer_room_host(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION connect_auth.transfer_room_host(UUID, TEXT) TO connect_app;

-- Media sessions are the server's view of who is connected; without any, the join record decides.
CREATE OR REPLACE FUNCTION connect_auth.is_participant_connected(p_room_id UUID, p_identity TEXT)
RETURNS BOOLEAN
SECURITY DEFINER
SET search_path = pg_catalog, public, connect_auth
LANGUAGE sql STABLE AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.room_participants rp
        WHERE rp.room_id = p_room_id AND rp.identity = p_identity AND rp.left_at IS NULL AND NOT rp.is_removed
    ) AND (
        EXISTS (
            SELECT 1 FROM public.participant_media_sessions m
            WHERE m.room_id = p_room_id AND m.identity = p_identity AND m.left_at IS NULL
        )
        OR NOT EXISTS (
            SELECT 1 FROM public.participant_media_sessions m
            WHERE m.room_id = p_room_id AND m.identity = p_identity
        )
    )
$$;

REVOKE ALL ON FUNCTION connect_auth.is_participant_connected(UUID, TEXT) FROM PUBLIC;

-- Runs after a grace period, so a host who merely reconnected keeps the meeting. Without a
-- connected co-host, ownership stays put and the host may return; the meeting carries on.
CREATE OR REPLACE FUNCTION connect_auth.succeed_room_host(p_room_id UUID)
RETURNS TEXT
SECURITY DEFINER
SET search_path = pg_catalog, public, connect_auth
LANGUAGE plpgsql AS $$
DECLARE
    v_host UUID;
    v_status TEXT;
    v_next TEXT;
BEGIN
    SELECT r.host_user_id, r.status INTO v_host, v_status FROM public.rooms r WHERE r.id = p_room_id FOR UPDATE;
    IF v_status IS DISTINCT FROM 'active'
       OR connect_auth.is_participant_connected(p_room_id, 'user:' || v_host::TEXT) THEN
        RETURN NULL;
    END IF;

    SELECT rp.identity INTO v_next
    FROM public.room_participants rp
    WHERE rp.room_id = p_room_id AND rp.role = 'co-host'
      AND connect_auth.room_access_role(p_room_id, rp.identity) = 'co-host'
      AND connect_auth.is_participant_connected(p_room_id, rp.identity)
    ORDER BY rp.joined_at ASC
    LIMIT 1;
    IF v_next IS NULL THEN
        RETURN NULL;
    END IF;

    PERFORM connect_auth.apply_host_change(p_room_id, v_host, v_next);
    INSERT INTO public.security_audit_events (event_type, severity, actor_id, metadata)
    VALUES ('room.host_succeeded', 'WARN', v_next, pg_catalog.jsonb_build_object('room_id', p_room_id, 'previous_host', v_host));
    RETURN v_next;
END;
$$;

REVOKE ALL ON FUNCTION connect_auth.succeed_room_host(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION connect_auth.succeed_room_host(UUID) TO connect_worker;

-- Called when an identity leaves. Does nothing unless it is the host of a running meeting.
CREATE OR REPLACE FUNCTION connect_auth.enqueue_host_succession(p_room_id UUID, p_identity TEXT, p_grace_seconds INT)
RETURNS VOID
SECURITY DEFINER
SET search_path = pg_catalog, public, connect_auth
LANGUAGE sql AS $$
    INSERT INTO public.background_jobs (queue, idempotency_key, payload, status, scheduled_at)
    SELECT 'default',
           'host-succession-' || r.id::TEXT || '-' || (EXTRACT(epoch FROM pg_catalog.clock_timestamp()) / 30)::BIGINT::TEXT,
           pg_catalog.jsonb_build_object('type', 'room.host_succession', 'data', pg_catalog.jsonb_build_object('roomId', r.id)),
           'pending',
           pg_catalog.clock_timestamp() + pg_catalog.make_interval(secs => p_grace_seconds)
    FROM public.rooms r
    WHERE r.id = p_room_id AND r.status = 'active' AND 'user:' || r.host_user_id::TEXT = p_identity
    ON CONFLICT (idempotency_key) DO NOTHING
$$;

REVOKE ALL ON FUNCTION connect_auth.enqueue_host_succession(UUID, TEXT, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION connect_auth.enqueue_host_succession(UUID, TEXT, INT) TO connect_app, connect_worker;

DROP FUNCTION connect_auth.room_by_code(TEXT);

CREATE FUNCTION connect_auth.room_by_code(p_code TEXT)
RETURNS TABLE (
    id UUID, public_code VARCHAR, host_user_id UUID, status VARCHAR, is_locked BOOLEAN,
    waiting_room_enabled BOOLEAN, max_participants INT, created_at TIMESTAMPTZ,
    started_at TIMESTAMPTZ, ended_at TIMESTAMPTZ, locked_at TIMESTAMPTZ,
    title VARCHAR, scheduled_start TIMESTAMPTZ, scheduled_end TIMESTAMPTZ, time_zone VARCHAR, passcode_hash TEXT,
    cohost_permissions JSONB, participants_can_publish BOOLEAN
)
SECURITY DEFINER
SET search_path = pg_catalog, public, connect_auth
LANGUAGE sql STABLE AS $$
    SELECT r.id, r.public_code, r.host_user_id, r.status, r.is_locked, r.waiting_room_enabled,
           r.max_participants, r.created_at, r.started_at, r.ended_at, r.locked_at,
           r.title, r.scheduled_start, r.scheduled_end, r.time_zone, r.passcode_hash, r.cohost_permissions, r.participants_can_publish
    FROM public.rooms r WHERE r.public_code = p_code
$$;

REVOKE ALL ON FUNCTION connect_auth.room_by_code(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION connect_auth.room_by_code(TEXT) TO connect_app;

-- Moderators act on regular participants, admissions, leases and the lock, each per permission.
CREATE POLICY rls_participants_moderate ON room_participants
    FOR UPDATE
    USING (connect_auth.is_room_moderator(room_id, 'remove') OR connect_auth.is_room_moderator(room_id, 'speakers'))
    WITH CHECK (connect_auth.is_room_moderator(room_id, 'remove') OR connect_auth.is_room_moderator(room_id, 'speakers'));

CREATE OR REPLACE FUNCTION connect_auth.guard_participant_update()
RETURNS TRIGGER
SET search_path = pg_catalog, public, connect_auth
LANGUAGE plpgsql AS $$
DECLARE
    v_role_changed BOOLEAN := NEW.role IS DISTINCT FROM OLD.role
        OR NEW.fencing_token IS DISTINCT FROM OLD.fencing_token
        OR NEW.transition_state IS DISTINCT FROM OLD.transition_state;
BEGIN
    IF CURRENT_USER <> 'connect_app' THEN
        RETURN NEW;
    END IF;
    IF NEW.identity IS DISTINCT FROM OLD.identity OR NEW.user_id IS DISTINCT FROM OLD.user_id
       OR NEW.room_id IS DISTINCT FROM OLD.room_id OR NEW.is_guest IS DISTINCT FROM OLD.is_guest THEN
        RAISE EXCEPTION 'participant identity is immutable' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF NOT v_role_changed AND NEW.is_removed IS NOT DISTINCT FROM OLD.is_removed THEN
        RETURN NEW;
    END IF;
    -- Host status changes only through the transfer functions, which do not run as connect_app.
    IF NEW.role = 'host' AND OLD.role <> 'host' THEN
        RAISE EXCEPTION 'host status cannot be assigned here' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF connect_auth.is_room_host(OLD.room_id) THEN
        RETURN NEW;
    END IF;
    IF OLD.role IN ('host', 'co-host') OR NEW.role IN ('host', 'co-host')
       OR (NEW.is_removed IS DISTINCT FROM OLD.is_removed AND NOT connect_auth.is_room_moderator(OLD.room_id, 'remove'))
       OR (v_role_changed AND NOT connect_auth.is_room_moderator(OLD.room_id, 'speakers')) THEN
        RAISE EXCEPTION 'only the host may change participant authority' USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
END;
$$;

CREATE POLICY rls_admissions_moderator_select ON room_admissions
    FOR SELECT USING (connect_auth.is_room_moderator(room_id, 'admit'));
CREATE POLICY rls_admissions_moderator_update ON room_admissions
    FOR UPDATE USING (connect_auth.is_room_moderator(room_id, 'admit')) WITH CHECK (connect_auth.is_room_moderator(room_id, 'admit'));

CREATE POLICY rls_participant_locks_moderator ON participant_locks
    USING (connect_auth.is_room_moderator(
        CASE WHEN split_part(lock_key, ':', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
             THEN split_part(lock_key, ':', 1)::UUID END, 'speakers'))
    WITH CHECK (connect_auth.is_room_moderator(
        CASE WHEN split_part(lock_key, ':', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
             THEN split_part(lock_key, ':', 1)::UUID END, 'speakers'));

CREATE POLICY rls_rooms_moderator_update ON rooms
    FOR UPDATE USING (connect_auth.is_room_moderator(id, 'lock')) WITH CHECK (connect_auth.is_room_moderator(id, 'lock'));

-- RLS cannot compare old and new values. Ownership moves only through the functions above,
-- and a co-host's update may touch nothing but the lock.
CREATE OR REPLACE FUNCTION connect_auth.guard_room_update()
RETURNS TRIGGER
SET search_path = pg_catalog, public, connect_auth
LANGUAGE plpgsql AS $$
BEGIN
    IF CURRENT_USER <> 'connect_app' THEN
        RETURN NEW;
    END IF;
    IF NEW.host_user_id IS DISTINCT FROM OLD.host_user_id THEN
        RAISE EXCEPTION 'room ownership changes only by transfer' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF NOT connect_auth.is_room_host(OLD.id) AND (
        NEW.status IS DISTINCT FROM OLD.status
        OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
        OR NEW.workspace_type IS DISTINCT FROM OLD.workspace_type
        OR NEW.passcode_hash IS DISTINCT FROM OLD.passcode_hash
        OR NEW.cohost_permissions IS DISTINCT FROM OLD.cohost_permissions
        OR NEW.participants_can_publish IS DISTINCT FROM OLD.participants_can_publish
        OR NEW.waiting_room_enabled IS DISTINCT FROM OLD.waiting_room_enabled
        OR NEW.scheduled_start IS DISTINCT FROM OLD.scheduled_start
        OR NEW.scheduled_end IS DISTINCT FROM OLD.scheduled_end
    ) THEN
        RAISE EXCEPTION 'only the host may change this meeting' USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_guard_room_update BEFORE UPDATE ON rooms
    FOR EACH ROW EXECUTE FUNCTION connect_auth.guard_room_update();

GRANT EXECUTE ON FUNCTION connect_auth.guard_room_update() TO connect_app, connect_worker;
