-- Reverses migration 000036 on a disposable database during verification. Deletes text,
-- shapes and notes, which the earlier schema cannot hold.
DROP FUNCTION IF EXISTS connect_auth.board_move(UUID, UUID, JSONB);
DELETE FROM board_strokes WHERE tool NOT IN ('pen', 'highlighter');
ALTER TABLE board_strokes DROP CONSTRAINT IF EXISTS ck_board_strokes_shape_points;
ALTER TABLE board_strokes DROP CONSTRAINT IF EXISTS ck_board_strokes_body;
ALTER TABLE board_strokes DROP COLUMN IF EXISTS body;
ALTER TABLE board_strokes DROP CONSTRAINT IF EXISTS ck_board_strokes_tool;
ALTER TABLE board_strokes ADD CONSTRAINT ck_board_strokes_tool CHECK (tool IN ('pen', 'highlighter'));
DELETE FROM schema_metadata WHERE version = '000036_board_text_shapes_notes';
