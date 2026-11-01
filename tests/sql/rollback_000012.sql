-- Reverses migration 000012 on a disposable database during verification.
ALTER POLICY rls_allocations_select ON faculty_allocations USING (
    connect_auth.is_super_admin() OR
    (
        organization_id = connect_auth.current_org_id() AND
        (
            connect_auth.current_role() IN ('institution_admin', 'institution_auditor') OR
            connect_auth.is_department_coordinator() OR
            faculty_user_id = connect_auth.current_user_id() OR
            EXISTS (
                SELECT 1 FROM course_enrollments ce
                JOIN course_batches cb ON cb.id = ce.batch_id
                WHERE cb.course_id = faculty_allocations.course_id
                  AND ce.student_user_id = connect_auth.current_user_id()
                  AND ce.status = 'enrolled'
            )
        )
    )
);
DROP FUNCTION IF EXISTS connect_auth.is_enrolled_in_course(UUID);
DELETE FROM schema_metadata WHERE version = '000012_fix_allocation_policy_recursion';
