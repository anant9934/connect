-- Rollback for 000032_live_engagement_and_attendance_sweep (functions only; no data is touched).
DROP FUNCTION IF EXISTS connect_auth.mark_attendance_finalized(UUID);
DROP FUNCTION IF EXISTS connect_auth.attendance_due_sessions(INT, TIMESTAMPTZ);
DROP FUNCTION IF EXISTS connect_auth.session_engagement_scores(UUID);
DROP FUNCTION IF EXISTS connect_auth.room_engagement(UUID);
DROP FUNCTION IF EXISTS connect_auth.room_engagement_data(UUID);
DROP FUNCTION IF EXISTS connect_auth.room_coding_assignments(UUID);

DELETE FROM schema_metadata WHERE version = '000032_live_engagement_and_attendance_sweep';
