-- Reverses migration 000010 on a disposable database during verification.
DROP TABLE IF EXISTS attendance_policies;
DROP TABLE IF EXISTS participant_media_sessions;
DROP TABLE IF EXISTS livekit_webhook_events;
ALTER TABLE attendance_records DROP COLUMN IF EXISTS policy_version;
DELETE FROM schema_metadata WHERE version = '000010_trusted_sessions_and_attendance_policies';
