-- ==============================================================================
-- Migration: 000024_admin_dashboard.sql
-- Organization overview and audit log for administrators and auditors. The audit table is
-- readable only by platform administrators, so organizations reach their own events here.
-- Rollback: tests/sql/rollback_000024.sql
-- ==============================================================================

INSERT INTO schema_metadata (version, description)
VALUES ('000024_admin_dashboard', 'Organization overview and audit log')
ON CONFLICT (version) DO NOTHING;

CREATE INDEX IF NOT EXISTS idx_audit_org_created
    ON security_audit_events ((metadata->>'organization_id'), created_at DESC);

CREATE OR REPLACE FUNCTION connect_auth.can_oversee_org(p_org UUID)
RETURNS BOOLEAN
SECURITY DEFINER SET search_path = pg_catalog, public, connect_auth
LANGUAGE sql STABLE AS $$
    SELECT connect_auth.is_super_admin()
        OR (connect_auth.current_org_id() = p_org AND connect_auth.current_org_role() IN ('institution_admin', 'institution_auditor'))
$$;

REVOKE ALL ON FUNCTION connect_auth.can_oversee_org(UUID) FROM PUBLIC;

CREATE OR REPLACE FUNCTION connect_auth.org_overview(p_org UUID)
RETURNS JSONB
SECURITY DEFINER SET search_path = pg_catalog, public, connect_auth
LANGUAGE plpgsql STABLE AS $$
DECLARE
    v_now TIMESTAMPTZ := pg_catalog.clock_timestamp();
BEGIN
    IF NOT connect_auth.can_oversee_org(p_org) THEN
        RAISE EXCEPTION 'not permitted to view this organization' USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN jsonb_build_object(
        'people', (
            SELECT jsonb_build_object(
                'active', count(*) FILTER (WHERE om.status = 'active'),
                'suspended', count(*) FILTER (WHERE om.status = 'suspended'),
                'revoked', count(*) FILTER (WHERE om.status = 'revoked'),
                'faculty', count(*) FILTER (WHERE om.status = 'active' AND om.role = 'faculty'),
                'students', count(*) FILTER (WHERE om.status = 'active' AND om.role = 'student'),
                'administrators', count(*) FILTER (WHERE om.status = 'active' AND om.role = 'institution_admin'))
            FROM public.organization_memberships om WHERE om.organization_id = p_org),
        'structure', jsonb_build_object(
            'departments', (SELECT count(*) FROM public.departments d WHERE d.organization_id = p_org AND d.status = 'active'),
            'courses', (SELECT count(*) FROM public.courses c WHERE c.organization_id = p_org AND c.status = 'active'),
            'batches', (SELECT count(*) FROM public.course_batches b WHERE b.organization_id = p_org),
            'enrollments', (SELECT count(*) FROM public.course_enrollments e WHERE e.organization_id = p_org AND e.status = 'enrolled')),
        'classes', (
            SELECT jsonb_build_object(
                'live', count(*) FILTER (WHERE cs.status = 'active'),
                'next7Days', count(*) FILTER (WHERE cs.status = 'scheduled' AND cs.scheduled_start >= v_now AND cs.scheduled_start < v_now + interval '7 days'),
                'completed30Days', count(*) FILTER (WHERE cs.status = 'completed' AND cs.scheduled_start >= v_now - interval '30 days'),
                'cancelled30Days', count(*) FILTER (WHERE cs.status = 'cancelled' AND cs.scheduled_start >= v_now - interval '30 days'),
                'awaitingAttendance', count(*) FILTER (WHERE cs.status <> 'cancelled' AND cs.scheduled_end < v_now AND NOT cs.attendance_finalized))
            FROM public.class_sessions cs WHERE cs.organization_id = p_org),
        'attendance30Days', (
            SELECT jsonb_build_object(
                'present', count(*) FILTER (WHERE ar.attendance_status = 'present'),
                'late', count(*) FILTER (WHERE ar.attendance_status = 'late'),
                'partial', count(*) FILTER (WHERE ar.attendance_status = 'partial'),
                'absent', count(*) FILTER (WHERE ar.attendance_status = 'absent'),
                'corrected', count(*) FILTER (WHERE ar.is_overruled))
            FROM public.attendance_records ar
            JOIN public.class_sessions cs ON cs.organization_id = ar.organization_id AND cs.id = ar.class_session_id
            WHERE ar.organization_id = p_org AND cs.scheduled_start >= v_now - interval '30 days')
    );
END;
$$;

REVOKE ALL ON FUNCTION connect_auth.org_overview(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION connect_auth.org_overview(UUID) TO connect_app;

-- Addresses and raw metadata stay out: this shows who did what, and to whom.
CREATE OR REPLACE FUNCTION connect_auth.org_audit_events(
    p_org UUID, p_event TEXT, p_from TIMESTAMPTZ, p_to TIMESTAMPTZ, p_limit INT, p_offset INT
)
RETURNS TABLE (id UUID, event_type VARCHAR, severity VARCHAR, actor_name VARCHAR, target_name VARCHAR, target TEXT, created_at TIMESTAMPTZ, total BIGINT)
SECURITY DEFINER SET search_path = pg_catalog, public, connect_auth
LANGUAGE plpgsql STABLE AS $$
BEGIN
    IF NOT connect_auth.can_oversee_org(p_org) THEN
        RAISE EXCEPTION 'not permitted to view this organization' USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN QUERY
    WITH matched AS (
        SELECT e.id, e.event_type, e.severity, e.actor_id, e.metadata->>'target' AS target, e.created_at,
               count(*) OVER () AS total
        FROM public.security_audit_events e
        WHERE e.metadata->>'organization_id' = p_org::TEXT
          AND (p_event IS NULL OR e.event_type = p_event)
          AND (p_from IS NULL OR e.created_at >= p_from)
          AND (p_to IS NULL OR e.created_at < p_to)
        ORDER BY e.created_at DESC, e.id
        LIMIT p_limit OFFSET p_offset
    )
    SELECT m.id, m.event_type, m.severity, a.display_name, t.display_name, m.target, m.created_at, m.total
    FROM matched m
    LEFT JOIN public.users a ON a.id::TEXT = m.actor_id
    LEFT JOIN public.users t ON t.id::TEXT = m.target
    ORDER BY m.created_at DESC, m.id;
END;
$$;

REVOKE ALL ON FUNCTION connect_auth.org_audit_events(UUID, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, INT, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION connect_auth.org_audit_events(UUID, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, INT, INT) TO connect_app;
