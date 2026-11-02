-- Reverses migration 000027 on a disposable database during verification.
DROP FUNCTION IF EXISTS connect_auth.board_remove(UUID, TEXT, BOOLEAN);
DROP FUNCTION IF EXISTS connect_auth.classroom_update(UUID, BOOLEAN, UUID, INT, INT, BOOLEAN);
DROP TABLE IF EXISTS board_strokes;
DROP FUNCTION IF EXISTS connect_auth.can_draw(UUID);
DROP TABLE IF EXISTS room_classroom_state;
DELETE FROM schema_metadata WHERE version = '000027_classroom_boards';
