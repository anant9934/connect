-- ==============================================================================
-- Migration: 000023_meeting_search.sql
-- Meeting history search. RLS lets any signed-in user read unlocked personal rooms by code, so
-- history uses an explicit list of what this person may see, built from indexed paths.
-- Rollback: tests/sql/rollback_000023.sql
-- ==============================================================================

INSERT INTO schema_metadata (version, description)
VALUES ('000023_meeting_search', 'Meeting history search and detail')
ON CONFLICT (version) DO NOTHING;

CREATE INDEX IF NOT EXISTS idx_rooms_org_created ON rooms(organization_id, created_at DESC) WHERE organization_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_rooms_class_session ON rooms(class_session_id) WHERE class_session_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_room_participants_identity_room ON room_participants(identity, room_id);
CREATE INDEX IF NOT EXISTS idx_class_sessions_batch ON class_sessions(batch_id);
CREATE INDEX IF NOT EXISTS idx_class_sessions_course ON class_sessions(course_id);

-- One row per meeting, with the strongest reason this person may see it.
CREATE OR REPLACE FUNCTION connect_auth.visible_meetings()
RETURNS TABLE (room_id UUID, access TEXT)
SECURITY DEFINER SET search_path = pg_catalog, public, connect_auth
LANGUAGE sql STABLE AS $$
    WITH me AS (SELECT connect_auth.current_user_id() AS id),
    paths AS (
        SELECT r.id AS room_id, 'host' AS access, 1 AS rank
        FROM public.rooms r, me WHERE r.host_user_id = me.id
        UNION ALL
        SELECT r.id, 'admin', 2
        FROM public.organization_memberships om
        JOIN me ON om.user_id = me.id
        JOIN public.rooms r ON r.organization_id = om.organization_id
        WHERE om.status = 'active' AND om.role IN ('institution_admin', 'institution_auditor')
        UNION ALL
        SELECT r.id, 'admin', 2
        FROM public.departments d
        JOIN me ON d.coordinator_user_id = me.id
        JOIN public.courses c ON c.department_id = d.id
        JOIN public.class_sessions cs ON cs.course_id = c.id
        JOIN public.rooms r ON r.class_session_id = cs.id
        UNION ALL
        SELECT r.id, 'faculty', 3
        FROM public.faculty_allocations fa
        JOIN me ON fa.faculty_user_id = me.id
        JOIN public.class_sessions cs ON cs.course_id = fa.course_id
        JOIN public.rooms r ON r.class_session_id = cs.id
        WHERE fa.status IN ('active', 'ended')
        UNION ALL
        SELECT rp.room_id, 'participant', 4
        FROM public.room_participants rp, me
        WHERE rp.identity = 'user:' || me.id::TEXT AND NOT rp.is_removed
        UNION ALL
        SELECT r.id, 'student', 5
        FROM public.course_enrollments ce
        JOIN me ON ce.student_user_id = me.id
        JOIN public.class_sessions cs ON cs.batch_id = ce.batch_id
        JOIN public.rooms r ON r.class_session_id = cs.id
        WHERE ce.status IN ('enrolled', 'completed')
    )
    SELECT DISTINCT ON (p.room_id) p.room_id, p.access FROM paths p ORDER BY p.room_id, p.rank
$$;

REVOKE ALL ON FUNCTION connect_auth.visible_meetings() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION connect_auth.visible_meetings() TO connect_app;

CREATE OR REPLACE FUNCTION connect_auth.search_meetings(
    p_query TEXT, p_statuses TEXT[], p_from TIMESTAMPTZ, p_to TIMESTAMPTZ, p_host UUID, p_participant UUID,
    p_course UUID, p_org UUID, p_sort TEXT, p_limit INT, p_offset INT
)
RETURNS TABLE (
    id UUID, public_code VARCHAR, title VARCHAR, status VARCHAR, meeting_at TIMESTAMPTZ, ended_at TIMESTAMPTZ,
    host_name VARCHAR, access TEXT, course_title VARCHAR, organization_id UUID, organization_name VARCHAR,
    participant_count BIGINT, total BIGINT
)
SECURITY DEFINER SET search_path = pg_catalog, public, connect_auth
LANGUAGE sql STABLE AS $$
    WITH matched AS (
        SELECT r.id, r.public_code, r.title, r.status, r.ended_at, r.host_user_id, r.organization_id,
               r.class_session_id, v.access,
               COALESCE(r.scheduled_start, r.started_at, r.created_at) AS meeting_at
        FROM connect_auth.visible_meetings() v
        JOIN public.rooms r ON r.id = v.room_id
        WHERE (p_query IS NULL
               OR r.title ILIKE '%' || replace(replace(replace(p_query, '\', '\\'), '%', '\%'), '_', '\_') || '%'
               OR replace(r.public_code, '-', '') ILIKE replace(replace(replace(replace(p_query, '-', ''), '\', '\\'), '%', '\%'), '_', '\_') || '%')
          AND (p_statuses IS NULL OR r.status = ANY(p_statuses))
          AND (p_from IS NULL OR COALESCE(r.scheduled_start, r.started_at, r.created_at) >= p_from)
          AND (p_to IS NULL OR COALESCE(r.scheduled_start, r.started_at, r.created_at) < p_to)
          AND (p_host IS NULL OR r.host_user_id = p_host)
          AND (p_org IS NULL OR r.organization_id = p_org)
          AND (p_course IS NULL OR EXISTS (
              SELECT 1 FROM public.class_sessions cs WHERE cs.id = r.class_session_id AND cs.course_id = p_course))
          -- Who attended is known only to those who run the meeting, so this filter is limited to them.
          AND (p_participant IS NULL OR (v.access IN ('host', 'admin', 'faculty') AND EXISTS (
              SELECT 1 FROM public.room_participants rp
              WHERE rp.room_id = r.id AND rp.identity = 'user:' || p_participant::TEXT)))
    ),
    counted AS (SELECT m.*, count(*) OVER () AS total FROM matched m),
    page AS (
        SELECT * FROM counted c
        ORDER BY
            CASE WHEN p_sort = 'oldest' THEN c.meeting_at END ASC,
            CASE WHEN p_sort = 'title' THEN pg_catalog.lower(COALESCE(c.title, '')) END ASC,
            CASE WHEN p_sort NOT IN ('oldest', 'title') THEN c.meeting_at END DESC,
            c.id
        LIMIT p_limit OFFSET p_offset
    )
    SELECT p.id, p.public_code, p.title, p.status, p.meeting_at, p.ended_at, u.display_name, p.access, co.title,
           p.organization_id, o.name,
           CASE WHEN p.access IN ('host', 'admin', 'faculty') THEN
               (SELECT count(DISTINCT rp.identity) FROM public.room_participants rp WHERE rp.room_id = p.id) END,
           p.total
    FROM page p
    JOIN public.users u ON u.id = p.host_user_id
    LEFT JOIN public.organizations o ON o.id = p.organization_id
    LEFT JOIN public.class_sessions cs ON cs.id = p.class_session_id
    LEFT JOIN public.courses co ON co.id = cs.course_id
    ORDER BY
        CASE WHEN p_sort = 'oldest' THEN p.meeting_at END ASC,
        CASE WHEN p_sort = 'title' THEN pg_catalog.lower(COALESCE(p.title, '')) END ASC,
        CASE WHEN p_sort NOT IN ('oldest', 'title') THEN p.meeting_at END DESC,
        p.id
$$;

REVOKE ALL ON FUNCTION connect_auth.search_meetings(TEXT, TEXT[], TIMESTAMPTZ, TIMESTAMPTZ, UUID, UUID, UUID, UUID, TEXT, INT, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION connect_auth.search_meetings(TEXT, TEXT[], TIMESTAMPTZ, TIMESTAMPTZ, UUID, UUID, UUID, UUID, TEXT, INT, INT) TO connect_app;

-- NULL when the person may not see this meeting. People who run it get the attendee list;
-- everyone else gets only their own part.
CREATE OR REPLACE FUNCTION connect_auth.meeting_detail(p_room UUID)
RETURNS JSONB
SECURITY DEFINER SET search_path = pg_catalog, public, connect_auth
LANGUAGE plpgsql STABLE AS $$
DECLARE
    v_access TEXT;
    v_me TEXT := 'user:' || connect_auth.current_user_id()::TEXT;
    v_staff BOOLEAN;
    v_result JSONB;
BEGIN
    SELECT v.access INTO v_access FROM connect_auth.visible_meetings() v WHERE v.room_id = p_room;
    IF v_access IS NULL THEN
        RETURN NULL;
    END IF;
    v_staff := v_access IN ('host', 'admin', 'faculty');
    SELECT jsonb_build_object(
        'id', r.id, 'publicCode', r.public_code, 'title', r.title, 'status', r.status,
        'meetingAt', COALESCE(r.scheduled_start, r.started_at, r.created_at),
        'startedAt', r.started_at, 'endedAt', r.ended_at, 'access', v_access, 'hostName', u.display_name,
        'courseTitle', co.title, 'organizationName', o.name, 'classSessionId', r.class_session_id,
        'organizationId', r.organization_id,
        'participants', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                'displayName', rp.display_name, 'role', rp.role, 'isGuest', rp.is_guest,
                'joinedAt', rp.joined_at, 'leftAt', rp.left_at, 'isYou', rp.identity = v_me) ORDER BY rp.joined_at)
            FROM public.room_participants rp
            WHERE rp.room_id = r.id AND (v_staff OR rp.identity = v_me)
        ), '[]'::jsonb),
        'myAttendance', (
            SELECT jsonb_build_object('status', ar.attendance_status, 'connectedSeconds', ar.total_connected_seconds)
            FROM public.attendance_records ar
            WHERE ar.class_session_id = r.class_session_id AND ar.student_user_id = connect_auth.current_user_id()
        ),
        'attendanceSummary', CASE WHEN v_staff THEN (
            SELECT jsonb_object_agg(s.attendance_status, s.n) FROM (
                SELECT ar.attendance_status, count(*) AS n FROM public.attendance_records ar
                WHERE ar.class_session_id = r.class_session_id GROUP BY 1
            ) s
        ) END
    ) INTO v_result
    FROM public.rooms r
    JOIN public.users u ON u.id = r.host_user_id
    LEFT JOIN public.organizations o ON o.id = r.organization_id
    LEFT JOIN public.class_sessions cs ON cs.id = r.class_session_id
    LEFT JOIN public.courses co ON co.id = cs.course_id
    WHERE r.id = p_room;
    RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION connect_auth.meeting_detail(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION connect_auth.meeting_detail(UUID) TO connect_app;
