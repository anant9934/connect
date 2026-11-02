-- Reverses migration 000026 on a disposable database during verification.
DROP FUNCTION IF EXISTS connect_auth.meeting_calendar(UUID, TIMESTAMPTZ, INT);
DELETE FROM schema_metadata WHERE version = '000026_calendar_export';
