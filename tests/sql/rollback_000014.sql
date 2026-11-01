-- Reverses migration 000014 on a disposable database during verification.
DROP POLICY IF EXISTS rls_files_member_update ON meeting_files;
DROP POLICY IF EXISTS rls_files_member_insert ON meeting_files;
DROP POLICY IF EXISTS rls_files_member_select ON meeting_files;
DROP FUNCTION IF EXISTS connect_auth.is_room_host(UUID);
DROP FUNCTION IF EXISTS connect_auth.current_guest_identity();
DROP FUNCTION IF EXISTS connect_auth.current_guest_room();
DROP FUNCTION IF EXISTS connect_auth.guest_context_valid();
DROP FUNCTION IF EXISTS connect_auth.authenticate_room_guest(UUID, TEXT);
DELETE FROM schema_metadata WHERE version = '000014_room_guest_context';
