-- ==============================================================================
-- Migration: 000012_fix_allocation_policy_recursion.sql
-- faculty_allocations and course_enrollments policies referenced each other,
-- raising "infinite recursion detected" on class session reads.
-- Rollback: tests/sql/rollback_000012.sql
-- ==============================================================================

INSERT INTO schema_metadata (version, description)
VALUES ('000012_fix_allocation_policy_recursion', 'Break RLS recursion between faculty allocations and enrollments')
ON CONFLICT (version) DO NOTHING;

-- Answers only whether the current user is enrolled, and returns no rows.
CREATE OR REPLACE FUNCTION connect_auth.is_enrolled_in_course(p_course_id UUID)
RETURNS BOOLEAN
SECURITY DEFINER
SET search_path = pg_catalog, public, connect_auth
LANGUAGE sql STABLE AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.course_enrollments ce
        JOIN public.course_batches cb ON cb.id = ce.batch_id
        WHERE cb.course_id = p_course_id
          AND ce.student_user_id = connect_auth.current_user_id()
          AND ce.status = 'enrolled'
    )
$$;

REVOKE ALL ON FUNCTION connect_auth.is_enrolled_in_course(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION connect_auth.is_enrolled_in_course(UUID) TO connect_app, connect_worker;

ALTER POLICY rls_allocations_select ON faculty_allocations USING (
    connect_auth.is_super_admin() OR
    (
        organization_id = connect_auth.current_org_id() AND
        (
            connect_auth.current_role() IN ('institution_admin', 'institution_auditor') OR
            connect_auth.is_department_coordinator() OR
            faculty_user_id = connect_auth.current_user_id() OR
            connect_auth.is_enrolled_in_course(course_id)
        )
    )
);
