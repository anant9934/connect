-- Reverses migration 000013 on a disposable database during verification.
DROP FUNCTION IF EXISTS connect_auth.guest_upsert_note(UUID, TEXT, TEXT, TEXT, INT);
DROP FUNCTION IF EXISTS connect_auth.guest_read_note(UUID, TEXT);
DROP POLICY IF EXISTS rls_notes_member_update ON meeting_notes;
DROP POLICY IF EXISTS rls_notes_member_insert ON meeting_notes;
DROP POLICY IF EXISTS rls_notes_member_select ON meeting_notes;
DROP FUNCTION IF EXISTS connect_auth.is_room_member(UUID);
DROP FUNCTION IF EXISTS connect_auth.resolve_room_access(TEXT, TEXT);
DROP FUNCTION IF EXISTS connect_auth.room_access_role(UUID, TEXT);
DELETE FROM schema_metadata WHERE version = '000013_room_participant_access';
