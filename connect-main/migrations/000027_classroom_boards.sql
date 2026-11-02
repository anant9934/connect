-- ==============================================================================
-- Migration: 000027_classroom_boards.sql
-- Whiteboard and presentation annotations as persisted strokes, and the shared presentation
-- state. Coordinates are 0-1 so they survive any screen size. Persisted state is the source of
-- truth; the data channel only hints that something changed.
-- Rollback: tests/sql/rollback_000027.sql
-- ==============================================================================

INSERT INTO schema_metadata (version, description)
VALUES ('000027_classroom_boards', 'Whiteboard, annotations and shared presentations')
ON CONFLICT (version) DO NOTHING;

CREATE TABLE IF NOT EXISTS room_classroom_state (
    room_id UUID PRIMARY KEY REFERENCES rooms(id) ON DELETE CASCADE,
    students_can_draw BOOLEAN NOT NULL DEFAULT false,
    presentation_file_id UUID REFERENCES meeting_files(id) ON DELETE SET NULL,
    presentation_page INT NOT NULL DEFAULT 1,
    presentation_pages INT NOT NULL DEFAULT 0,
    presenter_identity VARCHAR(128),
    -- Rises on any change that a client cannot learn by reading newer strokes.
    version BIGINT NOT NULL DEFAULT 1,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT ck_classroom_page CHECK (presentation_pages >= 0 AND presentation_page >= 1)
);

CREATE TABLE IF NOT EXISTS board_strokes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    seq BIGINT GENERATED ALWAYS AS IDENTITY,
    room_id UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    board VARCHAR(80) NOT NULL,
    author_identity VARCHAR(128) NOT NULL,
    tool VARCHAR(16) NOT NULL DEFAULT 'pen',
    color VARCHAR(7) NOT NULL,
    width SMALLINT NOT NULL,
    points JSONB NOT NULL,
    client_stroke_id VARCHAR(64) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    deleted_at TIMESTAMPTZ,
    CONSTRAINT uq_board_strokes_retry UNIQUE (room_id, author_identity, client_stroke_id),
    CONSTRAINT ck_board_strokes_tool CHECK (tool IN ('pen', 'highlighter')),
    CONSTRAINT ck_board_strokes_color CHECK (color ~ '^#[0-9a-fA-F]{6}$'),
    CONSTRAINT ck_board_strokes_width CHECK (width BETWEEN 1 AND 40),
    CONSTRAINT ck_board_strokes_board CHECK (board ~ '^(whiteboard|slide:[0-9a-f-]{36}:[0-9]{1,4})$')
);

CREATE INDEX IF NOT EXISTS idx_board_strokes_read ON board_strokes(room_id, board, seq) WHERE deleted_at IS NULL;

ALTER TABLE room_classroom_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE room_classroom_state FORCE ROW LEVEL SECURITY;
ALTER TABLE board_strokes ENABLE ROW LEVEL SECURITY;
ALTER TABLE board_strokes FORCE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION connect_auth.can_draw(p_room UUID)
RETURNS BOOLEAN
SECURITY DEFINER SET search_path = pg_catalog, public, connect_auth
LANGUAGE sql STABLE AS $$
    SELECT connect_auth.can_use_room(p_room) AND (
        connect_auth.can_announce(p_room)
        OR EXISTS (SELECT 1 FROM public.room_classroom_state s WHERE s.room_id = p_room AND s.students_can_draw))
$$;

REVOKE ALL ON FUNCTION connect_auth.can_draw(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION connect_auth.can_draw(UUID) TO connect_app;

CREATE POLICY rls_classroom_state_select ON room_classroom_state FOR SELECT
    USING (connect_auth.is_super_admin() OR connect_auth.can_use_room(room_id));
CREATE POLICY rls_board_strokes_select ON board_strokes FOR SELECT
    USING (connect_auth.is_super_admin() OR connect_auth.can_use_room(room_id));
CREATE POLICY rls_board_strokes_insert ON board_strokes FOR INSERT
    WITH CHECK (connect_auth.can_draw(room_id) AND author_identity = connect_auth.current_room_identity());

GRANT SELECT ON room_classroom_state TO connect_app;
GRANT SELECT, INSERT ON board_strokes TO connect_app;

-- Only the host or a co-host changes shared state. A file must already belong to this room.
CREATE OR REPLACE FUNCTION connect_auth.classroom_update(
    p_room UUID, p_students_can_draw BOOLEAN, p_file UUID, p_pages INT, p_page INT, p_stop BOOLEAN
)
RETURNS VOID
SECURITY DEFINER SET search_path = pg_catalog, public, connect_auth
LANGUAGE plpgsql AS $$
DECLARE
    v_pages INT;
    v_file UUID;
    v_type TEXT;
BEGIN
    IF NOT connect_auth.can_announce(p_room) THEN
        RAISE EXCEPTION 'only the host or a co-host can do this' USING ERRCODE = 'insufficient_privilege';
    END IF;
    INSERT INTO public.room_classroom_state (room_id) VALUES (p_room) ON CONFLICT (room_id) DO NOTHING;
    SELECT s.presentation_pages, s.presentation_file_id INTO v_pages, v_file
    FROM public.room_classroom_state s WHERE s.room_id = p_room FOR UPDATE;

    IF p_file IS NOT NULL THEN
        SELECT f.content_type INTO v_type FROM public.meeting_files f
        WHERE f.id = p_file AND f.room_id = p_room AND f.scan_status NOT IN ('rejected', 'quarantined', 'deleted');
        IF v_type IS NULL THEN
            RAISE EXCEPTION 'this file is not in this meeting' USING ERRCODE = 'CN404';
        END IF;
        IF v_type NOT IN ('application/pdf', 'application/vnd.openxmlformats-officedocument.presentationml.presentation') THEN
            RAISE EXCEPTION 'only PDF and PowerPoint files can be presented' USING ERRCODE = 'CN422';
        END IF;
        IF p_pages IS NULL OR p_pages NOT BETWEEN 1 AND 2000 THEN
            RAISE EXCEPTION 'a presentation has 1 to 2000 pages' USING ERRCODE = 'CN422';
        END IF;
        v_pages := p_pages;
        v_file := p_file;
    END IF;
    IF p_page IS NOT NULL AND (v_file IS NULL OR p_page NOT BETWEEN 1 AND v_pages) THEN
        RAISE EXCEPTION 'that page does not exist' USING ERRCODE = 'CN422';
    END IF;

    UPDATE public.room_classroom_state s SET
        students_can_draw = COALESCE(p_students_can_draw, s.students_can_draw),
        presentation_file_id = CASE WHEN p_stop THEN NULL WHEN p_file IS NOT NULL THEN p_file ELSE s.presentation_file_id END,
        presentation_pages = CASE WHEN p_stop THEN 0 WHEN p_file IS NOT NULL THEN p_pages ELSE s.presentation_pages END,
        presentation_page = CASE WHEN p_stop THEN 1 WHEN p_file IS NOT NULL THEN COALESCE(p_page, 1) ELSE COALESCE(p_page, s.presentation_page) END,
        presenter_identity = CASE WHEN p_stop THEN NULL WHEN p_file IS NOT NULL THEN connect_auth.current_room_identity() ELSE s.presenter_identity END,
        version = s.version + 1,
        updated_at = pg_catalog.clock_timestamp()
    WHERE s.room_id = p_room;
END;
$$;

REVOKE ALL ON FUNCTION connect_auth.classroom_update(UUID, BOOLEAN, UUID, INT, INT, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION connect_auth.classroom_update(UUID, BOOLEAN, UUID, INT, INT, BOOLEAN) TO connect_app;

-- Removes this person's newest stroke, or for moderators with p_all, the whole board.
CREATE OR REPLACE FUNCTION connect_auth.board_remove(p_room UUID, p_board TEXT, p_all BOOLEAN)
RETURNS INT
SECURITY DEFINER SET search_path = pg_catalog, public, connect_auth
LANGUAGE plpgsql AS $$
DECLARE
    v_count INT;
    v_me TEXT := connect_auth.current_room_identity();
BEGIN
    IF NOT connect_auth.can_use_room(p_room) OR (p_all AND NOT connect_auth.can_announce(p_room)) THEN
        RAISE EXCEPTION 'not permitted to change this board' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF p_all THEN
        UPDATE public.board_strokes b SET deleted_at = pg_catalog.clock_timestamp()
        WHERE b.room_id = p_room AND b.board = p_board AND b.deleted_at IS NULL;
    ELSE
        UPDATE public.board_strokes b SET deleted_at = pg_catalog.clock_timestamp()
        WHERE b.id = (
            SELECT s.id FROM public.board_strokes s
            WHERE s.room_id = p_room AND s.board = p_board AND s.author_identity = v_me AND s.deleted_at IS NULL
            ORDER BY s.seq DESC LIMIT 1);
    END IF;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    IF v_count > 0 THEN
        INSERT INTO public.room_classroom_state AS s (room_id) VALUES (p_room)
        ON CONFLICT (room_id) DO UPDATE SET version = s.version + 1, updated_at = pg_catalog.clock_timestamp();
    END IF;
    RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION connect_auth.board_remove(UUID, TEXT, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION connect_auth.board_remove(UUID, TEXT, BOOLEAN) TO connect_app;
