-- Reverses migration 000034 on a disposable database during verification.
DROP FUNCTION IF EXISTS connect_auth.room_code_by_number(BIGINT);
DROP FUNCTION IF EXISTS connect_auth.room_by_code(TEXT);
-- Restores the definition from 000018.
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
ALTER TABLE rooms DROP CONSTRAINT IF EXISTS ck_rooms_meeting_number;
ALTER TABLE rooms DROP CONSTRAINT IF EXISTS uq_rooms_meeting_number;
ALTER TABLE rooms DROP COLUMN IF EXISTS meeting_number;
DROP FUNCTION IF EXISTS connect_auth.new_meeting_number();
DELETE FROM schema_metadata WHERE version = '000034_meeting_numbers';
