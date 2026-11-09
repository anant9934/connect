-- ==============================================================================
-- Migration: 000033_live_generated_canvas.sql
-- The live canvas a host or co-host generates during class: an AI slide deck or an interactive
-- simulation. Content is validated JSON that clients render; it never holds code to run.
-- Stored state is the source of truth, so a late joiner lands on the current slide or the
-- current simulation settings. The data channel only carries hints and presenter frames.
-- Rollback: tests/sql/rollback_000033.sql
-- ==============================================================================

INSERT INTO schema_metadata (version, description)
VALUES ('000033_live_generated_canvas', 'Live AI slides and simulations in class')
ON CONFLICT (version) DO NOTHING;

CREATE TABLE IF NOT EXISTS room_live_canvas (
    room_id UUID PRIMARY KEY REFERENCES rooms(id) ON DELETE CASCADE,
    kind VARCHAR(16) NOT NULL,
    -- New on every publish, so sandbox answers to an older simulation are not shown as current.
    generation UUID NOT NULL DEFAULT gen_random_uuid(),
    content JSONB NOT NULL,
    slide INT NOT NULL DEFAULT 1,
    slide_count INT NOT NULL DEFAULT 0,
    sim_mode VARCHAR(16) NOT NULL DEFAULT 'presenter',
    sim_params JSONB NOT NULL DEFAULT '{}'::jsonb,
    presenter_identity VARCHAR(128) NOT NULL,
    version BIGINT NOT NULL DEFAULT 1,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT ck_live_canvas_kind CHECK (kind IN ('slides', 'simulation')),
    CONSTRAINT ck_live_canvas_mode CHECK (sim_mode IN ('presenter', 'sandbox')),
    CONSTRAINT ck_live_canvas_content CHECK (jsonb_typeof(content) = 'object' AND pg_column_size(content) <= 262144),
    CONSTRAINT ck_live_canvas_params CHECK (jsonb_typeof(sim_params) = 'object' AND pg_column_size(sim_params) <= 8192),
    CONSTRAINT ck_live_canvas_slide CHECK (slide >= 1 AND slide_count BETWEEN 0 AND 40)
);

CREATE TABLE IF NOT EXISTS live_sim_submissions (
    room_id UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    identity VARCHAR(128) NOT NULL,
    display_name VARCHAR(255) NOT NULL,
    generation UUID NOT NULL,
    params JSONB NOT NULL,
    submitted_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (room_id, identity),
    CONSTRAINT ck_live_sim_submission_params CHECK (jsonb_typeof(params) = 'object' AND pg_column_size(params) <= 8192)
);

ALTER TABLE room_live_canvas ENABLE ROW LEVEL SECURITY;
ALTER TABLE room_live_canvas FORCE ROW LEVEL SECURITY;
ALTER TABLE live_sim_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE live_sim_submissions FORCE ROW LEVEL SECURITY;

CREATE POLICY rls_live_canvas_select ON room_live_canvas FOR SELECT
    USING (connect_auth.is_super_admin() OR connect_auth.can_use_room(room_id));
-- A student sees only their own answer; moderators see everyone's.
CREATE POLICY rls_live_sim_submissions_select ON live_sim_submissions FOR SELECT
    USING (connect_auth.is_super_admin() OR connect_auth.can_announce(room_id)
        OR (connect_auth.can_use_room(room_id) AND identity = connect_auth.current_room_identity()));

GRANT SELECT ON room_live_canvas TO connect_app;
GRANT SELECT ON live_sim_submissions TO connect_app;

-- Replaces the canvas with newly generated content. Host or co-host only.
CREATE OR REPLACE FUNCTION connect_auth.live_canvas_publish(
    p_room UUID, p_kind TEXT, p_content JSONB, p_slide_count INT, p_params JSONB
)
RETURNS VOID
SECURITY DEFINER SET search_path = pg_catalog, public, connect_auth
LANGUAGE plpgsql AS $$
BEGIN
    IF NOT connect_auth.can_announce(p_room) THEN
        RAISE EXCEPTION 'only the host or a co-host can do this' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF p_kind = 'slides' AND (p_slide_count IS NULL OR p_slide_count NOT BETWEEN 1 AND 40) THEN
        RAISE EXCEPTION 'a deck has 1 to 40 slides' USING ERRCODE = 'CN422';
    END IF;
    DELETE FROM public.live_sim_submissions s WHERE s.room_id = p_room;
    INSERT INTO public.room_live_canvas AS c
        (room_id, kind, content, slide, slide_count, sim_mode, sim_params, presenter_identity)
    VALUES (p_room, p_kind, p_content, 1, CASE WHEN p_kind = 'slides' THEN p_slide_count ELSE 0 END,
            'presenter', COALESCE(p_params, '{}'::jsonb), connect_auth.current_room_identity())
    ON CONFLICT (room_id) DO UPDATE SET
        kind = EXCLUDED.kind,
        generation = gen_random_uuid(),
        content = EXCLUDED.content,
        slide = 1,
        slide_count = EXCLUDED.slide_count,
        sim_mode = 'presenter',
        sim_params = EXCLUDED.sim_params,
        presenter_identity = EXCLUDED.presenter_identity,
        version = c.version + 1,
        updated_at = pg_catalog.clock_timestamp();
END;
$$;

REVOKE ALL ON FUNCTION connect_auth.live_canvas_publish(UUID, TEXT, JSONB, INT, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION connect_auth.live_canvas_publish(UUID, TEXT, JSONB, INT, JSONB) TO connect_app;

-- Moves the slide, changes the simulation mode or settings, or closes the canvas.
CREATE OR REPLACE FUNCTION connect_auth.live_canvas_update(
    p_room UUID, p_slide INT, p_mode TEXT, p_params JSONB, p_stop BOOLEAN
)
RETURNS VOID
SECURITY DEFINER SET search_path = pg_catalog, public, connect_auth
LANGUAGE plpgsql AS $$
DECLARE
    v_kind TEXT;
    v_count INT;
BEGIN
    IF NOT connect_auth.can_announce(p_room) THEN
        RAISE EXCEPTION 'only the host or a co-host can do this' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF p_stop THEN
        DELETE FROM public.live_sim_submissions s WHERE s.room_id = p_room;
        DELETE FROM public.room_live_canvas c WHERE c.room_id = p_room;
        RETURN;
    END IF;
    SELECT c.kind, c.slide_count INTO v_kind, v_count FROM public.room_live_canvas c WHERE c.room_id = p_room FOR UPDATE;
    IF v_kind IS NULL THEN
        RAISE EXCEPTION 'nothing is on the live canvas' USING ERRCODE = 'CN404';
    END IF;
    IF p_slide IS NOT NULL AND (v_kind <> 'slides' OR p_slide NOT BETWEEN 1 AND v_count) THEN
        RAISE EXCEPTION 'that slide does not exist' USING ERRCODE = 'CN422';
    END IF;
    IF (p_mode IS NOT NULL OR p_params IS NOT NULL) AND v_kind <> 'simulation' THEN
        RAISE EXCEPTION 'only a simulation has settings' USING ERRCODE = 'CN422';
    END IF;
    UPDATE public.room_live_canvas c SET
        slide = COALESCE(p_slide, c.slide),
        sim_mode = COALESCE(p_mode, c.sim_mode),
        sim_params = COALESCE(p_params, c.sim_params),
        version = c.version + 1,
        updated_at = pg_catalog.clock_timestamp()
    WHERE c.room_id = p_room;
END;
$$;

REVOKE ALL ON FUNCTION connect_auth.live_canvas_update(UUID, INT, TEXT, JSONB, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION connect_auth.live_canvas_update(UUID, INT, TEXT, JSONB, BOOLEAN) TO connect_app;

-- Replaces one slide (0-based index) after the teacher edits it.
CREATE OR REPLACE FUNCTION connect_auth.live_canvas_edit_slide(p_room UUID, p_index INT, p_slide JSONB)
RETURNS VOID
SECURITY DEFINER SET search_path = pg_catalog, public, connect_auth
LANGUAGE plpgsql AS $$
DECLARE
    v_kind TEXT;
    v_count INT;
BEGIN
    IF NOT connect_auth.can_announce(p_room) THEN
        RAISE EXCEPTION 'only the host or a co-host can do this' USING ERRCODE = 'insufficient_privilege';
    END IF;
    SELECT c.kind, c.slide_count INTO v_kind, v_count FROM public.room_live_canvas c WHERE c.room_id = p_room FOR UPDATE;
    IF v_kind IS DISTINCT FROM 'slides' THEN
        RAISE EXCEPTION 'no deck is on the live canvas' USING ERRCODE = 'CN404';
    END IF;
    IF p_index IS NULL OR p_index NOT BETWEEN 0 AND v_count - 1 THEN
        RAISE EXCEPTION 'that slide does not exist' USING ERRCODE = 'CN422';
    END IF;
    UPDATE public.room_live_canvas c SET
        content = jsonb_set(c.content, ARRAY['slides', p_index::text], p_slide),
        version = c.version + 1,
        updated_at = pg_catalog.clock_timestamp()
    WHERE c.room_id = p_room;
END;
$$;

REVOKE ALL ON FUNCTION connect_auth.live_canvas_edit_slide(UUID, INT, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION connect_auth.live_canvas_edit_slide(UUID, INT, JSONB) TO connect_app;

-- A participant sends their simulation settings back while the host has opened sandbox mode.
CREATE OR REPLACE FUNCTION connect_auth.live_sim_submit(p_room UUID, p_params JSONB)
RETURNS VOID
SECURITY DEFINER SET search_path = pg_catalog, public, connect_auth
LANGUAGE plpgsql AS $$
DECLARE
    v_me TEXT := connect_auth.current_room_identity();
    v_generation UUID;
    v_name TEXT;
BEGIN
    IF NOT connect_auth.can_use_room(p_room) OR v_me IS NULL THEN
        RAISE EXCEPTION 'not permitted in this meeting' USING ERRCODE = 'insufficient_privilege';
    END IF;
    SELECT c.generation INTO v_generation FROM public.room_live_canvas c
    WHERE c.room_id = p_room AND c.kind = 'simulation' AND c.sim_mode = 'sandbox';
    IF v_generation IS NULL THEN
        RAISE EXCEPTION 'the simulation is not open for answers' USING ERRCODE = 'CN422';
    END IF;
    SELECT p.display_name INTO v_name FROM public.room_participants p
    WHERE p.room_id = p_room AND p.identity = v_me ORDER BY p.joined_at DESC LIMIT 1;
    INSERT INTO public.live_sim_submissions AS s (room_id, identity, display_name, generation, params)
    VALUES (p_room, v_me, COALESCE(v_name, 'Participant'), v_generation, p_params)
    ON CONFLICT (room_id, identity) DO UPDATE SET
        display_name = EXCLUDED.display_name,
        generation = EXCLUDED.generation,
        params = EXCLUDED.params,
        submitted_at = pg_catalog.clock_timestamp();
END;
$$;

REVOKE ALL ON FUNCTION connect_auth.live_sim_submit(UUID, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION connect_auth.live_sim_submit(UUID, JSONB) TO connect_app;
