-- ==============================================================================
-- Migration: 000042_board_math.sql
-- Math blocks on boards: a LaTeX-style formula kept as the item's text, drawn by the client.
-- Math blocks move like notes. Whiteboard coordinates may now leave the 0-1 square (the API
-- allows -4 to 5) so the whiteboard can pan and zoom like an endless canvas.
-- Rollback: tests/sql/rollback_000042.sql
-- ==============================================================================

INSERT INTO schema_metadata (version, description)
VALUES ('000042_board_math', 'Board math blocks')
ON CONFLICT (version) DO NOTHING;

ALTER TABLE board_strokes DROP CONSTRAINT IF EXISTS ck_board_strokes_tool;
ALTER TABLE board_strokes ADD CONSTRAINT ck_board_strokes_tool
    CHECK (tool IN ('pen', 'highlighter', 'text', 'rect', 'circle', 'arrow', 'note', 'math'));
ALTER TABLE board_strokes DROP CONSTRAINT IF EXISTS ck_board_strokes_body;
ALTER TABLE board_strokes ADD CONSTRAINT ck_board_strokes_body
    CHECK ((tool IN ('text', 'note', 'math')) = (body IS NOT NULL AND pg_catalog.length(pg_catalog.btrim(body)) > 0));
ALTER TABLE board_strokes DROP CONSTRAINT IF EXISTS ck_board_strokes_shape_points;
ALTER TABLE board_strokes ADD CONSTRAINT ck_board_strokes_shape_points
    CHECK (CASE
        WHEN tool IN ('rect', 'circle', 'arrow') THEN jsonb_array_length(points) = 2
        WHEN tool IN ('text', 'note', 'math') THEN jsonb_array_length(points) = 1
        ELSE true END);

CREATE OR REPLACE FUNCTION connect_auth.board_move(p_room UUID, p_stroke UUID, p_points JSONB)
RETURNS VOID
SECURITY DEFINER SET search_path = pg_catalog, public, connect_auth
LANGUAGE plpgsql AS $$
DECLARE
    v_author TEXT;
    v_tool TEXT;
BEGIN
    IF NOT connect_auth.can_draw(p_room) THEN
        RAISE EXCEPTION 'not permitted to change this board' USING ERRCODE = 'insufficient_privilege';
    END IF;
    SELECT b.author_identity, b.tool INTO v_author, v_tool FROM public.board_strokes b
    WHERE b.id = p_stroke AND b.room_id = p_room AND b.deleted_at IS NULL FOR UPDATE;
    IF v_tool IS NULL THEN
        RAISE EXCEPTION 'that item is not on this board' USING ERRCODE = 'CN404';
    END IF;
    IF v_tool NOT IN ('text', 'note', 'math') THEN
        RAISE EXCEPTION 'only notes, text and math can be moved' USING ERRCODE = 'CN422';
    END IF;
    IF v_author <> connect_auth.current_room_identity() AND NOT connect_auth.can_announce(p_room) THEN
        RAISE EXCEPTION 'only its author or a moderator can move this' USING ERRCODE = 'insufficient_privilege';
    END IF;
    UPDATE public.board_strokes SET points = p_points WHERE id = p_stroke;
    INSERT INTO public.room_classroom_state AS s (room_id) VALUES (p_room)
    ON CONFLICT (room_id) DO UPDATE SET version = s.version + 1, updated_at = pg_catalog.clock_timestamp();
END;
$$;
