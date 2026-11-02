-- Reverses migration 000025 on a disposable database during verification.
DROP FUNCTION IF EXISTS connect_auth.my_attendance_detail(UUID);
DROP FUNCTION IF EXISTS connect_auth.session_engagement(UUID);
DROP FUNCTION IF EXISTS connect_auth.room_signals(UUID);
DROP FUNCTION IF EXISTS connect_auth.report_browser_activity(UUID, INT, INT);
DROP TABLE IF EXISTS browser_activity;
ALTER TABLE attendance_records
    DROP COLUMN IF EXISTS calculation, DROP COLUMN IF EXISTS score, DROP COLUMN IF EXISTS browser_ratio,
    DROP COLUMN IF EXISTS engagement_ratio, DROP COLUMN IF EXISTS duration_ratio, DROP COLUMN IF EXISTS left_early,
    DROP COLUMN IF EXISTS joined_late, DROP COLUMN IF EXISTS last_left_at, DROP COLUMN IF EXISTS first_joined_at;
ALTER TABLE attendance_policies
    DROP CONSTRAINT IF EXISTS ck_attendance_policies_target, DROP CONSTRAINT IF EXISTS ck_attendance_policies_weights,
    DROP CONSTRAINT IF EXISTS ck_attendance_policies_early, DROP COLUMN IF EXISTS engagement_target,
    DROP COLUMN IF EXISTS browser_weight, DROP COLUMN IF EXISTS engagement_weight, DROP COLUMN IF EXISTS duration_weight,
    DROP COLUMN IF EXISTS early_leave_grace_seconds;
DELETE FROM schema_metadata WHERE version = '000025_attendance_signals';
