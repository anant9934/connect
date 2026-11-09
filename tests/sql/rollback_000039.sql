-- Reverses migration 000039 on a disposable database during verification.
DROP FUNCTION IF EXISTS connect_auth.attendance_pillars(UUID, UUID);
DELETE FROM schema_metadata WHERE version = '000039_attendance_pillars';
