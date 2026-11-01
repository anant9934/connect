-- Reverses migration 000011 on a disposable database during verification.
DROP POLICY IF EXISTS rls_attendance_records_worker ON attendance_records;
DROP POLICY IF EXISTS rls_course_enrollments_worker_select ON course_enrollments;
DROP POLICY IF EXISTS rls_class_sessions_worker_select ON class_sessions;
DROP POLICY IF EXISTS rls_room_participants_worker ON room_participants;
DROP POLICY IF EXISTS rls_rooms_worker_select ON rooms;
DROP FUNCTION IF EXISTS connect_auth.webhook_room_id(TEXT);
DELETE FROM schema_metadata WHERE version = '000011_service_role_access';
