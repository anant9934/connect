-- Reverses migration 000017 on a disposable database during verification.
DROP FUNCTION IF EXISTS connect_auth.room_by_code(TEXT);

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

REVOKE ALL ON FUNCTION connect_auth.room_by_code(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION connect_auth.room_by_code(TEXT) TO connect_app;

DROP INDEX IF EXISTS idx_rooms_host_upcoming;
ALTER TABLE rooms DROP CONSTRAINT IF EXISTS ck_rooms_schedule_order;
ALTER TABLE rooms
    DROP COLUMN IF EXISTS passcode_hash,
    DROP COLUMN IF EXISTS time_zone,
    DROP COLUMN IF EXISTS scheduled_end,
    DROP COLUMN IF EXISTS scheduled_start,
    DROP COLUMN IF EXISTS title;
DELETE FROM schema_metadata WHERE version = '000017_scheduled_meetings_and_passcodes';
