-- ==============================================================================
-- Migration: 000011_service_role_access.sql
-- Narrow access for trusted paths with no end-user auth context.
-- Rollback: tests/sql/rollback_000011.sql
-- ==============================================================================

INSERT INTO schema_metadata (version, description)
VALUES ('000011_service_role_access', 'Webhook room resolver and connect_worker policies for attendance reconciliation')
ON CONFLICT (version) DO NOTHING;

-- Signed webhooks have no user context. This exposes only code-to-id resolution, not room rows.
CREATE OR REPLACE FUNCTION connect_auth.webhook_room_id(p_public_code TEXT)
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
    SELECT id FROM public.rooms WHERE public_code = p_public_code
$$;

REVOKE ALL ON FUNCTION connect_auth.webhook_room_id(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION connect_auth.webhook_room_id(TEXT) TO connect_app, connect_worker;

-- Reconciliation spans tenants by design and is limited to the worker role.
CREATE POLICY rls_rooms_worker_select ON rooms
    FOR SELECT TO connect_worker USING (true);
CREATE POLICY rls_room_participants_worker ON room_participants
    FOR ALL TO connect_worker USING (true) WITH CHECK (true);
CREATE POLICY rls_class_sessions_worker_select ON class_sessions
    FOR SELECT TO connect_worker USING (true);
CREATE POLICY rls_course_enrollments_worker_select ON course_enrollments
    FOR SELECT TO connect_worker USING (true);
CREATE POLICY rls_attendance_records_worker ON attendance_records
    FOR ALL TO connect_worker USING (true) WITH CHECK (true);
