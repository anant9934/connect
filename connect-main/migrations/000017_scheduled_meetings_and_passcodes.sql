-- ==============================================================================
-- Migration: 000017_scheduled_meetings_and_passcodes.sql
-- Rooms may be scheduled ahead and protected by a hashed passcode. Additive only.
-- Rollback: tests/sql/rollback_000017.sql
-- ==============================================================================

INSERT INTO schema_metadata (version, description)
VALUES ('000017_scheduled_meetings_and_passcodes', 'Scheduled meetings and meeting passcodes')
ON CONFLICT (version) DO NOTHING;

ALTER TABLE rooms
    ADD COLUMN IF NOT EXISTS title VARCHAR(200),
    ADD COLUMN IF NOT EXISTS scheduled_start TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS scheduled_end TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS time_zone VARCHAR(64),
    ADD COLUMN IF NOT EXISTS passcode_hash TEXT;

ALTER TABLE rooms ADD CONSTRAINT ck_rooms_schedule_order
    CHECK (scheduled_start IS NULL OR scheduled_end IS NULL OR scheduled_end > scheduled_start);

CREATE INDEX IF NOT EXISTS idx_rooms_host_upcoming ON rooms(host_user_id, scheduled_start)
    WHERE status = 'scheduled';

-- The return type changes, so the function is replaced rather than altered.
DROP FUNCTION connect_auth.room_by_code(TEXT);

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
