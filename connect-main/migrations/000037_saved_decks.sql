-- ==============================================================================
-- Migration: 000037_saved_decks.sql
-- A host or co-host saves the live AI deck to the class vault, so everyone in the meeting can
-- open it from meeting history after class. The copy is taken from the stored live canvas, so a
-- saved deck is always one that was shown, never content sent by the client.
-- Rollback: tests/sql/rollback_000037.sql
-- ==============================================================================

INSERT INTO schema_metadata (version, description)
VALUES ('000037_saved_decks', 'Saved live decks in the class vault')
ON CONFLICT (version) DO NOTHING;

CREATE TABLE IF NOT EXISTS room_saved_decks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    room_id UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    title VARCHAR(200) NOT NULL,
    content JSONB NOT NULL,
    slide_count INT NOT NULL,
    saved_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT ck_saved_decks_content CHECK (jsonb_typeof(content) = 'object' AND pg_column_size(content) <= 262144),
    CONSTRAINT ck_saved_decks_slides CHECK (slide_count BETWEEN 1 AND 40)
);
CREATE INDEX IF NOT EXISTS idx_saved_decks_room ON room_saved_decks(room_id, created_at DESC);

ALTER TABLE room_saved_decks ENABLE ROW LEVEL SECURITY;
ALTER TABLE room_saved_decks FORCE ROW LEVEL SECURITY;
CREATE POLICY rls_saved_decks_select ON room_saved_decks FOR SELECT
    USING (connect_auth.is_super_admin() OR connect_auth.is_room_member(room_id));
GRANT SELECT ON room_saved_decks TO connect_app;

CREATE OR REPLACE FUNCTION connect_auth.save_live_deck(p_room UUID)
RETURNS UUID
SECURITY DEFINER SET search_path = pg_catalog, public, connect_auth
LANGUAGE plpgsql AS $$
DECLARE
    v_content JSONB;
    v_count INT;
    v_id UUID;
BEGIN
    IF NOT connect_auth.can_announce(p_room) THEN
        RAISE EXCEPTION 'only the host or a co-host can do this' USING ERRCODE = 'insufficient_privilege';
    END IF;
    SELECT c.content, c.slide_count INTO v_content, v_count FROM public.room_live_canvas c
    WHERE c.room_id = p_room AND c.kind = 'slides';
    IF v_content IS NULL THEN
        RAISE EXCEPTION 'no deck is on the live canvas' USING ERRCODE = 'CN404';
    END IF;
    IF (SELECT count(*) FROM public.room_saved_decks d WHERE d.room_id = p_room) >= 50 THEN
        RAISE EXCEPTION 'this meeting already has 50 saved decks' USING ERRCODE = 'CN422';
    END IF;
    INSERT INTO public.room_saved_decks (room_id, title, content, slide_count, saved_by)
    VALUES (p_room, COALESCE(NULLIF(pg_catalog.left(v_content->>'title', 200), ''), 'Class deck'), v_content, v_count, connect_auth.current_user_id())
    RETURNING id INTO v_id;
    RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION connect_auth.save_live_deck(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION connect_auth.save_live_deck(UUID) TO connect_app;
