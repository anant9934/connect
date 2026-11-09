-- Reverses migration 000038 on a disposable database during verification.
DROP FUNCTION IF EXISTS connect_auth.recording_save(UUID, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, JSONB);
DROP FUNCTION IF EXISTS connect_auth.transcript_add(UUID, TEXT, TIMESTAMPTZ, TEXT, TEXT, TEXT);
DROP TABLE IF EXISTS room_recordings;
DROP TABLE IF EXISTS room_transcript_segments;
DELETE FROM schema_metadata WHERE version = '000038_transcripts_and_recordings';
