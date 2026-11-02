-- Reverses migration 000028 on a disposable database during verification.
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
    RETURN QUERY
    SELECT s.user_id, u.display_name, s.messages, s.reactions, s.hands, s.poll_answers, s.doubts, s.visible_seconds, s.hidden_seconds, s.reported
    FROM connect_auth.room_signals(v_room) s
    JOIN public.users u ON u.id = s.user_id
    ORDER BY u.display_name, s.user_id;
END;
$$;

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
BEGIN
    SELECT r.workspace_type, r.organization_id, r.class_session_id, r.host_user_id
    INTO v_workspace, v_org, v_session, v_host
    FROM public.rooms r WHERE r.id = p_room_id;
    IF NOT FOUND THEN
        RETURN false;
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

DROP FUNCTION IF EXISTS connect_auth.breakout_state(UUID);
DROP FUNCTION IF EXISTS connect_auth.breakout_codes(UUID);
DROP FUNCTION IF EXISTS connect_auth.breakout_close_ended(UUID);
DROP FUNCTION IF EXISTS connect_auth.breakout_close(UUID);
DROP FUNCTION IF EXISTS connect_auth.breakout_assign(UUID, TEXT, UUID);
DROP FUNCTION IF EXISTS connect_auth.breakout_open(UUID, TEXT[], TEXT[]);
DROP FUNCTION IF EXISTS connect_auth.is_room_moderator_identity(UUID, TEXT);
DROP TABLE IF EXISTS breakout_assignments;
DELETE FROM rooms WHERE parent_room_id IS NOT NULL;
DROP INDEX IF EXISTS idx_rooms_parent;
ALTER TABLE rooms DROP COLUMN IF EXISTS breakout_name, DROP COLUMN IF EXISTS parent_room_id;
DELETE FROM schema_metadata WHERE version = '000028_breakout_rooms';
