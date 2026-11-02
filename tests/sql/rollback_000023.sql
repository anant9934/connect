-- Reverses migration 000023 on a disposable database during verification.
DROP FUNCTION IF EXISTS connect_auth.meeting_detail(UUID);
DROP FUNCTION IF EXISTS connect_auth.search_meetings(TEXT, TEXT[], TIMESTAMPTZ, TIMESTAMPTZ, UUID, UUID, UUID, UUID, TEXT, INT, INT);
DROP FUNCTION IF EXISTS connect_auth.visible_meetings();
DROP INDEX IF EXISTS idx_class_sessions_course;
DROP INDEX IF EXISTS idx_class_sessions_batch;
DROP INDEX IF EXISTS idx_room_participants_identity_room;
DROP INDEX IF EXISTS idx_rooms_class_session;
DROP INDEX IF EXISTS idx_rooms_org_created;
DELETE FROM schema_metadata WHERE version = '000023_meeting_search';
