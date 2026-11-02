-- ==============================================================================
-- Migration: 000026_calendar_export.sql
-- Calendar entries for the meetings a person may see, which covers class rooms hidden from them
-- by RLS. Reminders for personal meetings are read by the worker from rooms.
-- Rollback: tests/sql/rollback_000026.sql
-- ==============================================================================

INSERT INTO schema_metadata (version, description)
VALUES ('000026_calendar_export', 'Calendar export of visible meetings')
ON CONFLICT (version) DO NOTHING;

-- One meeting when p_room is set; otherwise everything from p_from on. Cancelled meetings stay, so
-- a calendar that imported them can remove them.
CREATE OR REPLACE FUNCTION connect_auth.meeting_calendar(p_room UUID, p_from TIMESTAMPTZ, p_limit INT)
RETURNS TABLE (id UUID, public_code VARCHAR, title VARCHAR, status VARCHAR, starts_at TIMESTAMPTZ, ends_at TIMESTAMPTZ, host_name VARCHAR)
SECURITY DEFINER SET search_path = pg_catalog, public, connect_auth
LANGUAGE sql STABLE AS $$
    SELECT r.id, r.public_code, r.title, r.status, r.scheduled_start, r.scheduled_end, u.display_name
    FROM connect_auth.visible_meetings() v
    JOIN public.rooms r ON r.id = v.room_id
    JOIN public.users u ON u.id = r.host_user_id
    WHERE r.scheduled_start IS NOT NULL AND r.scheduled_end IS NOT NULL
      AND (p_room IS NULL OR r.id = p_room)
      AND (p_room IS NOT NULL OR r.scheduled_end >= p_from)
    ORDER BY r.scheduled_start, r.id
    LIMIT p_limit
$$;

REVOKE ALL ON FUNCTION connect_auth.meeting_calendar(UUID, TIMESTAMPTZ, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION connect_auth.meeting_calendar(UUID, TIMESTAMPTZ, INT) TO connect_app;
