-- ==============================================================================
-- Migration: 000028_breakout_rooms.sql
-- Group discussion in breakout rooms. A breakout is an ordinary room under a main meeting, so chat,
-- media and notes work as they do elsewhere, while entry takes an assignment. Guests stay in the
-- main meeting, because a guest's signed identity belongs to one room.
-- Rollback: tests/sql/rollback_000028.sql
-- ==============================================================================

INSERT INTO schema_metadata (version, description)
VALUES ('000028_breakout_rooms', 'Breakout rooms for group discussion')
ON CONFLICT (version) DO NOTHING;

ALTER TABLE rooms ADD COLUMN IF NOT EXISTS parent_room_id UUID REFERENCES rooms(id) ON DELETE CASCADE;
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS breakout_name VARCHAR(60);
CREATE INDEX IF NOT EXISTS idx_rooms_parent ON rooms(parent_room_id) WHERE parent_room_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS breakout_assignments (
    parent_room_id UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    identity VARCHAR(128) NOT NULL,
    breakout_room_id UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    assigned_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (parent_room_id, identity),
    CONSTRAINT ck_breakout_identity CHECK (identity LIKE 'user:%')
);

CREATE INDEX IF NOT EXISTS idx_breakout_assignments_room ON breakout_assignments(breakout_room_id, identity);

ALTER TABLE breakout_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE breakout_assignments FORCE ROW LEVEL SECURITY;
REVOKE ALL ON breakout_assignments FROM connect_app, connect_worker;

-- Like can_announce, for an identity that is not the caller's: entry checks run for the person joining.
CREATE OR REPLACE FUNCTION connect_auth.is_room_moderator_identity(p_room UUID, p_identity TEXT)
RETURNS BOOLEAN
SECURITY DEFINER SET search_path = pg_catalog, public, connect_auth
LANGUAGE sql STABLE AS $$
    SELECT p_identity LIKE 'user:%' AND connect_auth.room_access_role(p_room, p_identity) IN ('host', 'co-host')
$$;

REVOKE ALL ON FUNCTION connect_auth.is_room_moderator_identity(UUID, TEXT) FROM PUBLIC;

CREATE OR REPLACE FUNCTION connect_auth.can_enter_room(p_room_id UUID, p_identity TEXT)
RETURNS BOOLEAN
SECURITY DEFINER
SET search_path = pg_catalog, public, connect_auth
LANGUAGE plpgsql STABLE AS $$
DECLARE
    v_workspace TEXT;
    v_org UUID;
    v_session UUID;
    v_host UUID;
    v_user UUID;
    v_role TEXT;
    v_parent UUID;
BEGIN
    SELECT r.workspace_type, r.organization_id, r.class_session_id, r.host_user_id
    INTO v_workspace, v_org, v_session, v_host
    FROM public.rooms r WHERE r.id = p_room_id;
    IF NOT FOUND THEN
        RETURN false;
    END IF;
    SELECT r.parent_room_id INTO v_parent FROM public.rooms r WHERE r.id = p_room_id;
    IF v_parent IS NOT NULL THEN
        -- A breakout is entered by being assigned to it, or by running the main meeting.
        RETURN EXISTS (
            SELECT 1 FROM public.breakout_assignments a
            WHERE a.breakout_room_id = p_room_id AND a.identity = p_identity
        ) OR 'user:' || v_host::TEXT = p_identity
          OR connect_auth.is_room_moderator_identity(v_parent, p_identity);
    END IF;
    IF v_workspace IS DISTINCT FROM 'institutional' THEN
        RETURN true;
    END IF;
    IF p_identity NOT LIKE 'user:%' THEN
        RETURN false;
    END IF;
    BEGIN
        v_user := substr(p_identity, 6)::UUID;
    EXCEPTION WHEN invalid_text_representation THEN
        RETURN false;
    END;
    SELECT om.role INTO v_role FROM public.organization_memberships om
    WHERE om.organization_id = v_org AND om.user_id = v_user AND om.status = 'active';
    IF v_role IS NULL THEN
        RETURN false;
    END IF;
    IF v_session IS NULL OR v_user = v_host OR v_role IN ('institution_admin', 'department_coordinator') THEN
        RETURN true;
    END IF;
    RETURN EXISTS (
        SELECT 1 FROM public.class_sessions cs
        JOIN public.course_enrollments ce ON ce.batch_id = cs.batch_id
        WHERE cs.id = v_session AND ce.student_user_id = v_user AND ce.status = 'enrolled'
    ) OR EXISTS (
        SELECT 1 FROM public.class_sessions cs
        JOIN public.faculty_allocations fa ON fa.course_id = cs.course_id
        WHERE cs.id = v_session AND fa.faculty_user_id = v_user AND fa.status = 'active'
    );
END;
$$;

-- p_codes come from the API's code generator, one per name.
CREATE OR REPLACE FUNCTION connect_auth.breakout_open(p_parent UUID, p_names TEXT[], p_codes TEXT[])
RETURNS VOID
SECURITY DEFINER SET search_path = pg_catalog, public, connect_auth
LANGUAGE plpgsql AS $$
DECLARE
    v_parent public.rooms%ROWTYPE;
BEGIN
    IF NOT connect_auth.can_announce(p_parent) THEN
        RAISE EXCEPTION 'only the host or a co-host can do this' USING ERRCODE = 'insufficient_privilege';
    END IF;
    SELECT * INTO v_parent FROM public.rooms r WHERE r.id = p_parent FOR UPDATE;
    IF v_parent.parent_room_id IS NOT NULL THEN
        RAISE EXCEPTION 'a breakout room cannot have breakout rooms' USING ERRCODE = 'CN422';
    END IF;
    IF v_parent.status <> 'active' THEN
        RAISE EXCEPTION 'this meeting is not in progress' USING ERRCODE = 'CN422';
    END IF;
    IF EXISTS (SELECT 1 FROM public.rooms r WHERE r.parent_room_id = p_parent AND r.status = 'active') THEN
        RAISE EXCEPTION 'breakout rooms are already open' USING ERRCODE = 'CN409';
    END IF;
    INSERT INTO public.rooms (public_code, host_user_id, status, organization_id, workspace_type, title, breakout_name,
                              max_participants, parent_room_id, participants_can_publish)
    SELECT x.code, v_parent.host_user_id, 'active', v_parent.organization_id, v_parent.workspace_type,
           left(COALESCE(v_parent.title || ': ', '') || x.name, 200), x.name, v_parent.max_participants, p_parent, true
    FROM unnest(p_names, p_codes) AS x(name, code);
END;
$$;

REVOKE ALL ON FUNCTION connect_auth.breakout_open(UUID, TEXT[], TEXT[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION connect_auth.breakout_open(UUID, TEXT[], TEXT[]) TO connect_app;

-- A NULL breakout returns the person to the main meeting.
CREATE OR REPLACE FUNCTION connect_auth.breakout_assign(p_parent UUID, p_identity TEXT, p_breakout UUID)
RETURNS VOID
SECURITY DEFINER SET search_path = pg_catalog, public, connect_auth
LANGUAGE plpgsql AS $$
BEGIN
    IF NOT connect_auth.can_announce(p_parent) THEN
        RAISE EXCEPTION 'only the host or a co-host can do this' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF p_breakout IS NULL THEN
        DELETE FROM public.breakout_assignments a WHERE a.parent_room_id = p_parent AND a.identity = p_identity;
        RETURN;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.rooms r WHERE r.id = p_breakout AND r.parent_room_id = p_parent AND r.status = 'active') THEN
        RAISE EXCEPTION 'that breakout room is not open' USING ERRCODE = 'CN404';
    END IF;
    IF p_identity NOT LIKE 'user:%' THEN
        RAISE EXCEPTION 'guests stay in the main meeting' USING ERRCODE = 'CN422';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM public.room_participants rp
        WHERE rp.room_id = p_parent AND rp.identity = p_identity AND NOT rp.is_removed
    ) THEN
        RAISE EXCEPTION 'this person is not in the meeting' USING ERRCODE = 'CN404';
    END IF;
    INSERT INTO public.breakout_assignments AS a (parent_room_id, identity, breakout_room_id)
    VALUES (p_parent, p_identity, p_breakout)
    ON CONFLICT (parent_room_id, identity) DO UPDATE SET breakout_room_id = EXCLUDED.breakout_room_id, assigned_at = pg_catalog.clock_timestamp();
END;
$$;

REVOKE ALL ON FUNCTION connect_auth.breakout_assign(UUID, TEXT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION connect_auth.breakout_assign(UUID, TEXT, UUID) TO connect_app;

-- Ends every open breakout and returns the codes, so the API can close them on the media server.
CREATE OR REPLACE FUNCTION connect_auth.breakout_close(p_parent UUID)
RETURNS TABLE (public_code VARCHAR)
SECURITY DEFINER SET search_path = pg_catalog, public, connect_auth
LANGUAGE plpgsql AS $$
BEGIN
    IF NOT connect_auth.can_announce(p_parent) THEN
        RAISE EXCEPTION 'only the host or a co-host can do this' USING ERRCODE = 'insufficient_privilege';
    END IF;
    UPDATE public.room_participants rp SET left_at = pg_catalog.clock_timestamp()
    FROM public.rooms r
    WHERE rp.room_id = r.id AND r.parent_room_id = p_parent AND r.status = 'active' AND rp.left_at IS NULL;
    DELETE FROM public.breakout_assignments a WHERE a.parent_room_id = p_parent;
    RETURN QUERY
    UPDATE public.rooms r SET status = 'ended', ended_at = pg_catalog.clock_timestamp()
    WHERE r.parent_room_id = p_parent AND r.status = 'active'
    RETURNING r.public_code;
END;
$$;

REVOKE ALL ON FUNCTION connect_auth.breakout_close(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION connect_auth.breakout_close(UUID) TO connect_app;

-- Runs as part of ending a meeting, and does nothing unless the meeting has ended.
CREATE OR REPLACE FUNCTION connect_auth.breakout_close_ended(p_parent UUID)
RETURNS VOID
SECURITY DEFINER SET search_path = pg_catalog, public, connect_auth
LANGUAGE plpgsql AS $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.rooms r WHERE r.id = p_parent AND r.status = 'ended') THEN
        RETURN;
    END IF;
    UPDATE public.room_participants rp SET left_at = pg_catalog.clock_timestamp()
    FROM public.rooms r
    WHERE rp.room_id = r.id AND r.parent_room_id = p_parent AND rp.left_at IS NULL;
    DELETE FROM public.breakout_assignments a WHERE a.parent_room_id = p_parent;
    UPDATE public.rooms r SET status = 'ended', ended_at = pg_catalog.clock_timestamp()
    WHERE r.parent_room_id = p_parent AND r.status = 'active';
END;
$$;

REVOKE ALL ON FUNCTION connect_auth.breakout_close_ended(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION connect_auth.breakout_close_ended(UUID) TO connect_app;

-- Reveals only random codes of rooms that have already ended, to terminate them on the media server.
CREATE OR REPLACE FUNCTION connect_auth.breakout_codes(p_parent UUID)
RETURNS TABLE (public_code VARCHAR)
SECURITY DEFINER SET search_path = pg_catalog, public, connect_auth
LANGUAGE sql STABLE AS $$
    SELECT r.public_code FROM public.rooms r
    WHERE r.parent_room_id = p_parent AND r.status = 'ended' AND connect_auth.can_announce(p_parent)
$$;

REVOKE ALL ON FUNCTION connect_auth.breakout_codes(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION connect_auth.breakout_codes(UUID) TO connect_app;

-- Moderators see everyone and every group. Participants see only where they are going, and from a
-- breakout, where to return to.
CREATE OR REPLACE FUNCTION connect_auth.breakout_state(p_room UUID)
RETURNS JSONB
SECURITY DEFINER SET search_path = pg_catalog, public, connect_auth
LANGUAGE plpgsql STABLE AS $$
DECLARE
    v_me TEXT := connect_auth.current_room_identity();
    v_parent UUID;
    v_main UUID;
    v_manage BOOLEAN;
BEGIN
    IF NOT connect_auth.can_use_room(p_room) THEN
        RAISE EXCEPTION 'not a participant in this meeting' USING ERRCODE = 'insufficient_privilege';
    END IF;
    SELECT r.parent_room_id INTO v_parent FROM public.rooms r WHERE r.id = p_room;
    v_main := COALESCE(v_parent, p_room);
    v_manage := connect_auth.can_announce(v_main);
    RETURN jsonb_build_object(
        'canManage', v_manage,
        'isBreakout', v_parent IS NOT NULL,
        'ended', (SELECT r.status = 'ended' FROM public.rooms r WHERE r.id = p_room),
        'mainCode', (SELECT r.public_code FROM public.rooms r WHERE r.id = v_main),
        'myRoom', (
            SELECT jsonb_build_object('id', r.id, 'code', r.public_code, 'name', r.breakout_name)
            FROM public.breakout_assignments a JOIN public.rooms r ON r.id = a.breakout_room_id
            WHERE a.parent_room_id = v_main AND a.identity = v_me AND r.status = 'active'),
        'rooms', CASE WHEN v_manage THEN COALESCE((
            SELECT jsonb_agg(jsonb_build_object('id', r.id, 'code', r.public_code, 'name', r.breakout_name) ORDER BY r.breakout_name)
            FROM public.rooms r WHERE r.parent_room_id = v_main AND r.status = 'active'), '[]'::jsonb) ELSE '[]'::jsonb END,
        'people', CASE WHEN v_manage THEN COALESCE((
            SELECT jsonb_agg(jsonb_build_object('identity', p.identity, 'displayName', p.display_name, 'isGuest', p.is_guest, 'breakoutId', a.breakout_room_id) ORDER BY p.display_name)
            FROM (
                SELECT DISTINCT ON (rp.identity) rp.identity, rp.display_name, rp.is_guest
                FROM public.room_participants rp
                WHERE rp.room_id = v_main AND rp.left_at IS NULL AND NOT rp.is_removed
                ORDER BY rp.identity, rp.joined_at DESC
            ) p
            LEFT JOIN public.breakout_assignments a ON a.parent_room_id = v_main AND a.identity = p.identity), '[]'::jsonb) ELSE '[]'::jsonb END
    );
END;
$$;

REVOKE ALL ON FUNCTION connect_auth.breakout_state(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION connect_auth.breakout_state(UUID) TO connect_app;

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
    -- A breakout is part of its main meeting, so it is not listed on its own.
    SELECT DISTINCT ON (p.room_id) p.room_id, p.access FROM paths p
    JOIN public.rooms listed ON listed.id = p.room_id AND listed.parent_room_id IS NULL
    ORDER BY p.room_id, p.rank
$$;

CREATE OR REPLACE FUNCTION connect_auth.session_engagement(p_session UUID)
RETURNS TABLE (user_id UUID, display_name VARCHAR, messages BIGINT, reactions BIGINT, hands BIGINT, poll_answers BIGINT, doubts BIGINT, visible_seconds INT, hidden_seconds INT, reported BOOLEAN)
SECURITY DEFINER SET search_path = pg_catalog, public, connect_auth
LANGUAGE plpgsql STABLE AS $$
DECLARE
    v_org UUID;
    v_room UUID;
BEGIN
    SELECT cs.organization_id, r.id INTO v_org, v_room
    FROM public.class_sessions cs LEFT JOIN public.rooms r ON r.class_session_id = cs.id
    WHERE cs.id = p_session;
    IF v_org IS NULL OR NOT (connect_auth.can_manage_session(p_session) OR connect_auth.can_oversee_org(v_org)) THEN
        RAISE EXCEPTION 'not permitted to view this class' USING ERRCODE = 'insufficient_privilege';
    END IF;
    -- What people do in group discussions counts toward the class.
    RETURN QUERY
    SELECT s.user_id, u.display_name, sum(s.messages)::BIGINT, sum(s.reactions)::BIGINT, sum(s.hands)::BIGINT, sum(s.poll_answers)::BIGINT, sum(s.doubts)::BIGINT,
           sum(s.visible_seconds)::INT, sum(s.hidden_seconds)::INT, bool_or(s.reported)
    FROM public.rooms family
    CROSS JOIN LATERAL connect_auth.room_signals(family.id) s
    JOIN public.users u ON u.id = s.user_id
    WHERE family.id = v_room OR family.parent_room_id = v_room
    GROUP BY s.user_id, u.display_name
    ORDER BY u.display_name, s.user_id;
END;
$$;
