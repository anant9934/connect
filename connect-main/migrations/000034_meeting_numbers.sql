-- ==============================================================================
-- Migration: 000034_meeting_numbers.sql
-- Every room gets an 11-digit meeting number people can type or read out (842 9103 8417),
-- alongside its ABCD-EFGH-JK code. A number only resolves to the room's code; every other
-- route still keys on the code, so LiveKit rooms and guest tokens are unchanged.
-- Rollback: tests/sql/rollback_000034.sql
-- ==============================================================================

INSERT INTO schema_metadata (version, description)
VALUES ('000034_meeting_numbers', 'Numeric meeting numbers for rooms')
ON CONFLICT (version) DO NOTHING;

-- 60 random bits from gen_random_uuid, folded into 10000000000-99999999999.
CREATE OR REPLACE FUNCTION connect_auth.new_meeting_number()
RETURNS BIGINT
SET search_path = pg_catalog, public
LANGUAGE sql VOLATILE AS $$
    SELECT 10000000000 + (('x' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 15))::bit(60)::bigint % 90000000000)
$$;

REVOKE ALL ON FUNCTION connect_auth.new_meeting_number() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION connect_auth.new_meeting_number() TO connect_app, connect_worker;

-- A volatile default is evaluated per row, so existing rooms each get their own number.
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS meeting_number BIGINT NOT NULL DEFAULT connect_auth.new_meeting_number();
ALTER TABLE rooms ADD CONSTRAINT uq_rooms_meeting_number UNIQUE (meeting_number);
ALTER TABLE rooms ADD CONSTRAINT ck_rooms_meeting_number CHECK (meeting_number BETWEEN 10000000000 AND 99999999999);

-- Same row as before plus the number; the return type changes, so drop and recreate.
DROP FUNCTION connect_auth.room_by_code(TEXT);
CREATE FUNCTION connect_auth.room_by_code(p_code TEXT)
RETURNS TABLE (
    id UUID, public_code VARCHAR, host_user_id UUID, status VARCHAR, is_locked BOOLEAN,
    waiting_room_enabled BOOLEAN, max_participants INT, created_at TIMESTAMPTZ,
    started_at TIMESTAMPTZ, ended_at TIMESTAMPTZ, locked_at TIMESTAMPTZ,
    title VARCHAR, scheduled_start TIMESTAMPTZ, scheduled_end TIMESTAMPTZ, time_zone VARCHAR, passcode_hash TEXT,
    cohost_permissions JSONB, participants_can_publish BOOLEAN, meeting_number BIGINT
)
SECURITY DEFINER
SET search_path = pg_catalog, public, connect_auth
LANGUAGE sql STABLE AS $$
    SELECT r.id, r.public_code, r.host_user_id, r.status, r.is_locked, r.waiting_room_enabled,
           r.max_participants, r.created_at, r.started_at, r.ended_at, r.locked_at,
           r.title, r.scheduled_start, r.scheduled_end, r.time_zone, r.passcode_hash, r.cohost_permissions,
           r.participants_can_publish, r.meeting_number
    FROM public.rooms r WHERE r.public_code = p_code
$$;
REVOKE ALL ON FUNCTION connect_auth.room_by_code(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION connect_auth.room_by_code(TEXT) TO connect_app;

-- Resolves a number to a code, as knowing either one is equivalent. The API rate-limits it.
CREATE OR REPLACE FUNCTION connect_auth.room_code_by_number(p_number BIGINT)
RETURNS TEXT
SECURITY DEFINER
SET search_path = pg_catalog, public, connect_auth
LANGUAGE sql STABLE AS $$
    SELECT r.public_code FROM public.rooms r WHERE r.meeting_number = p_number
$$;
REVOKE ALL ON FUNCTION connect_auth.room_code_by_number(BIGINT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION connect_auth.room_code_by_number(BIGINT) TO connect_app;
