-- Reverses migration 000043 on a disposable database during verification.
DROP FUNCTION IF EXISTS connect_auth.org_system_health(UUID);
DROP FUNCTION IF EXISTS connect_auth.my_meeting_summary();
DELETE FROM schema_metadata WHERE version = '000043_dashboard_summaries';
