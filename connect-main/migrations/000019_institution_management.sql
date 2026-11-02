-- ==============================================================================
-- Migration: 000019_institution_management.sql
-- Class sessions own a meeting room, recur as a series, and only their batch, faculty and
-- administrators may enter. Attendance policies become tenant-scoped for the API role.
-- Rollback: tests/sql/rollback_000019.sql
-- ==============================================================================

INSERT INTO schema_metadata (version, description)
VALUES ('000019_institution_management', 'Institution management, class rooms and recurring sessions')
ON CONFLICT (version) DO NOTHING;

ALTER TABLE class_sessions
    ADD COLUMN IF NOT EXISTS series_id UUID,
    ADD COLUMN IF NOT EXISTS time_zone VARCHAR(64) NOT NULL DEFAULT 'UTC';

CREATE INDEX IF NOT EXISTS idx_class_sessions_series ON class_sessions(organization_id, series_id);
CREATE INDEX IF NOT EXISTS idx_class_sessions_window ON class_sessions(organization_id, scheduled_start);

CREATE OR REPLACE FUNCTION connect_auth.my_organizations()
RETURNS TABLE (id UUID, slug VARCHAR, name VARCHAR, role VARCHAR)
SECURITY DEFINER SET search_path = pg_catalog, public, connect_auth
LANGUAGE sql STABLE AS $$
    SELECT o.id, o.slug, o.name, om.role
    FROM public.organization_memberships om
    JOIN public.organizations o ON o.id = om.organization_id
    WHERE om.user_id = connect_auth.current_user_id() AND om.status = 'active' AND o.status = 'active'
    ORDER BY o.name
$$;

REVOKE ALL ON FUNCTION connect_auth.my_organizations() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION connect_auth.my_organizations() TO connect_app;

-- Accounts are invisible across users, so adding by email and listing names go through here.
CREATE OR REPLACE FUNCTION connect_auth.org_add_member(p_org UUID, p_email TEXT, p_role TEXT, p_identifier TEXT)
RETURNS UUID
SECURITY DEFINER SET search_path = pg_catalog, public, connect_auth
LANGUAGE plpgsql AS $$
DECLARE
    v_user UUID;
BEGIN
    IF NOT (connect_auth.is_super_admin()
            OR (connect_auth.current_org_id() = p_org AND connect_auth.current_role() = 'institution_admin')) THEN
        RAISE EXCEPTION 'only an institution administrator may add members' USING ERRCODE = 'insufficient_privilege';
    END IF;
    SELECT u.id INTO v_user FROM public.users u WHERE u.email_normalized = pg_catalog.lower(pg_catalog.btrim(p_email));
    IF v_user IS NULL THEN
        RAISE EXCEPTION 'no account has this email address' USING ERRCODE = 'CN404';
    END IF;
    INSERT INTO public.organization_memberships (organization_id, user_id, role, member_identifier)
    VALUES (p_org, v_user, p_role, NULLIF(p_identifier, ''));
    RETURN v_user;
END;
$$;

REVOKE ALL ON FUNCTION connect_auth.org_add_member(UUID, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION connect_auth.org_add_member(UUID, TEXT, TEXT, TEXT) TO connect_app;

CREATE OR REPLACE FUNCTION connect_auth.org_members(p_org UUID)
RETURNS TABLE (user_id UUID, display_name VARCHAR, email VARCHAR, role VARCHAR, status VARCHAR, member_identifier VARCHAR)
SECURITY DEFINER SET search_path = pg_catalog, public, connect_auth
LANGUAGE plpgsql STABLE AS $$
BEGIN
    IF NOT (connect_auth.is_super_admin() OR (connect_auth.current_org_id() = p_org AND connect_auth.current_role()
            IN ('institution_admin', 'institution_auditor', 'department_coordinator', 'faculty'))) THEN
        RAISE EXCEPTION 'not permitted to list members' USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN QUERY
    SELECT om.user_id, u.display_name, u.email_normalized, om.role, om.status, om.member_identifier
    FROM public.organization_memberships om
    JOIN public.users u ON u.id = om.user_id
    WHERE om.organization_id = p_org
    ORDER BY u.display_name;
END;
$$;

REVOKE ALL ON FUNCTION connect_auth.org_members(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION connect_auth.org_members(UUID) TO connect_app;

-- Sessions the caller cannot read still count: a batch or a teacher cannot be double-booked.
CREATE OR REPLACE FUNCTION connect_auth.session_conflict(
    p_org UUID, p_batch UUID, p_allocation UUID, p_start TIMESTAMPTZ, p_end TIMESTAMPTZ, p_exclude UUID
)
RETURNS BOOLEAN
SECURITY DEFINER SET search_path = pg_catalog, public, connect_auth
LANGUAGE plpgsql STABLE AS $$
BEGIN
    IF connect_auth.current_org_id() IS DISTINCT FROM p_org THEN
        RAISE EXCEPTION 'wrong organization' USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN EXISTS (
        SELECT 1 FROM public.class_sessions cs
        JOIN public.faculty_allocations fa ON fa.id = cs.faculty_allocation_id
        WHERE cs.organization_id = p_org
          AND cs.status IN ('scheduled', 'active')
          AND cs.id IS DISTINCT FROM p_exclude
          AND cs.scheduled_start < p_end AND cs.scheduled_end > p_start
          AND (cs.batch_id = p_batch OR fa.faculty_user_id = (
              SELECT f.faculty_user_id FROM public.faculty_allocations f WHERE f.id = p_allocation))
    );
END;
$$;

REVOKE ALL ON FUNCTION connect_auth.session_conflict(UUID, UUID, UUID, TIMESTAMPTZ, TIMESTAMPTZ, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION connect_auth.session_conflict(UUID, UUID, UUID, TIMESTAMPTZ, TIMESTAMPTZ, UUID) TO connect_app;

-- May the caller manage this session? Administrators, and the faculty it is allocated to.
CREATE OR REPLACE FUNCTION connect_auth.can_manage_session(p_session UUID)
RETURNS BOOLEAN
SECURITY DEFINER SET search_path = pg_catalog, public, connect_auth
LANGUAGE sql STABLE AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.class_sessions cs
        JOIN public.faculty_allocations fa ON fa.id = cs.faculty_allocation_id
        WHERE cs.id = p_session
          AND cs.organization_id = connect_auth.current_org_id()
          AND (connect_auth.current_role() = 'institution_admin' OR fa.faculty_user_id = connect_auth.current_user_id())
    )
$$;

-- The room belongs to the allocated teacher even when an administrator schedules the class.
-- Classrooms start with publishing off; the teacher can open it up or promote speakers.
CREATE OR REPLACE FUNCTION connect_auth.create_session_room(p_session UUID, p_code TEXT)
RETURNS VOID
SECURITY DEFINER SET search_path = pg_catalog, public, connect_auth
LANGUAGE plpgsql AS $$
BEGIN
    IF NOT connect_auth.can_manage_session(p_session) THEN
        RAISE EXCEPTION 'not permitted to manage this session' USING ERRCODE = 'insufficient_privilege';
    END IF;
    INSERT INTO public.rooms (public_code, host_user_id, status, organization_id, class_session_id, workspace_type,
                              title, scheduled_start, scheduled_end, time_zone, participants_can_publish)
    SELECT p_code, fa.faculty_user_id, 'scheduled', cs.organization_id, cs.id, 'institutional',
           cs.title, cs.scheduled_start, cs.scheduled_end, cs.time_zone, false
    FROM public.class_sessions cs
    JOIN public.faculty_allocations fa ON fa.id = cs.faculty_allocation_id
    WHERE cs.id = p_session;
END;
$$;

CREATE OR REPLACE FUNCTION connect_auth.sync_session_room(p_session UUID)
RETURNS VOID
SECURITY DEFINER SET search_path = pg_catalog, public, connect_auth
LANGUAGE plpgsql AS $$
BEGIN
    IF NOT connect_auth.can_manage_session(p_session) THEN
        RAISE EXCEPTION 'not permitted to manage this session' USING ERRCODE = 'insufficient_privilege';
    END IF;
    UPDATE public.rooms r
    SET title = cs.title, scheduled_start = cs.scheduled_start, scheduled_end = cs.scheduled_end,
        status = CASE WHEN cs.status = 'cancelled' AND r.status = 'scheduled' THEN 'cancelled' ELSE r.status END
    FROM public.class_sessions cs
    WHERE r.class_session_id = cs.id AND cs.id = p_session;
END;
$$;

REVOKE ALL ON FUNCTION connect_auth.can_manage_session(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION connect_auth.create_session_room(UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION connect_auth.sync_session_room(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION connect_auth.can_manage_session(UUID) TO connect_app;
GRANT EXECUTE ON FUNCTION connect_auth.create_session_room(UUID, TEXT) TO connect_app;
GRANT EXECUTE ON FUNCTION connect_auth.sync_session_room(UUID) TO connect_app;

-- A meeting starting or ending is what moves its class session along, whoever triggered it.
CREATE OR REPLACE FUNCTION connect_auth.sync_class_session_from_room()
RETURNS TRIGGER
SECURITY DEFINER SET search_path = pg_catalog, public, connect_auth
LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.class_session_id IS NULL OR NEW.status IS NOT DISTINCT FROM OLD.status THEN
        RETURN NEW;
    END IF;
    UPDATE public.class_sessions cs
    SET status = CASE NEW.status WHEN 'active' THEN 'active' WHEN 'ended' THEN 'completed' WHEN 'cancelled' THEN 'cancelled' ELSE cs.status END,
        actual_start = CASE WHEN NEW.status = 'active' THEN COALESCE(cs.actual_start, pg_catalog.clock_timestamp()) ELSE cs.actual_start END,
        actual_end = CASE WHEN NEW.status = 'ended' THEN COALESCE(cs.actual_end, pg_catalog.clock_timestamp()) ELSE cs.actual_end END,
        updated_at = pg_catalog.clock_timestamp()
    WHERE cs.id = NEW.class_session_id;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_sync_class_session_from_room AFTER UPDATE OF status ON rooms
    FOR EACH ROW EXECUTE FUNCTION connect_auth.sync_class_session_from_room();

-- Membership alone no longer opens a class: it takes this batch, this course's faculty, or admin.
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

-- The API role saw every tenant's policies. The webhook does not read them; the worker has its own role.
ALTER POLICY rls_attendance_policies_service ON attendance_policies
    USING (
        connect_auth.is_super_admin() OR CURRENT_USER = 'connect_worker'
        OR organization_id = connect_auth.current_org_id()
    )
    WITH CHECK (
        connect_auth.is_super_admin() OR CURRENT_USER = 'connect_worker'
        OR (organization_id = connect_auth.current_org_id() AND connect_auth.current_role() = 'institution_admin')
    );
