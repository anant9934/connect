-- ==============================================================================
-- Migration: 000038_transcripts_and_recordings.sql
-- Live transcript segments from the host's browser speech recognition (or the free Whisper
-- fallback), shown as captions and kept for summaries and replay. Recording metadata for
-- recordings made locally in the host's browser: the video stays on the host's computer;
-- only its times and markers (slide changes, transcript lines) are stored, for seeking.
-- Rollback: tests/sql/rollback_000038.sql
-- ==============================================================================

INSERT INTO schema_metadata (version, description)
VALUES ('000038_transcripts_and_recordings', 'Live transcript segments and local recording markers')
ON CONFLICT (version) DO NOTHING;

CREATE TABLE IF NOT EXISTS room_transcript_segments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    seq BIGINT GENERATED ALWAYS AS IDENTITY,
    room_id UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    speaker_identity VARCHAR(128) NOT NULL,
    speaker_name VARCHAR(255) NOT NULL,
    spoken_at TIMESTAMPTZ NOT NULL,
    body VARCHAR(1000) NOT NULL,
    lang VARCHAR(10) NOT NULL,
    source VARCHAR(10) NOT NULL,
    client_segment_id VARCHAR(64) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT uq_transcript_retry UNIQUE (room_id, speaker_identity, client_segment_id),
    CONSTRAINT ck_transcript_lang CHECK (lang IN ('en-IN', 'hi-IN', 'en-US')),
    CONSTRAINT ck_transcript_source CHECK (source IN ('browser', 'whisper')),
    CONSTRAINT ck_transcript_body CHECK (pg_catalog.length(pg_catalog.btrim(body)) > 0)
);
CREATE INDEX IF NOT EXISTS idx_transcript_room_time ON room_transcript_segments(room_id, spoken_at);

CREATE TABLE IF NOT EXISTS room_recordings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    room_id UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    started_at TIMESTAMPTZ NOT NULL,
    ended_at TIMESTAMPTZ NOT NULL,
    file_name VARCHAR(200) NOT NULL,
    markers JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT ck_recording_times CHECK (ended_at > started_at AND ended_at - started_at <= INTERVAL '8 hours'),
    CONSTRAINT ck_recording_markers CHECK (jsonb_typeof(markers) = 'array' AND jsonb_array_length(markers) <= 1000 AND pg_column_size(markers) <= 262144)
);
CREATE INDEX IF NOT EXISTS idx_recordings_room ON room_recordings(room_id, started_at DESC);

ALTER TABLE room_transcript_segments ENABLE ROW LEVEL SECURITY;
ALTER TABLE room_transcript_segments FORCE ROW LEVEL SECURITY;
ALTER TABLE room_recordings ENABLE ROW LEVEL SECURITY;
ALTER TABLE room_recordings FORCE ROW LEVEL SECURITY;

CREATE POLICY rls_transcript_select ON room_transcript_segments FOR SELECT
    USING (connect_auth.is_super_admin() OR connect_auth.is_room_member(room_id) OR connect_auth.can_use_room(room_id));
CREATE POLICY rls_recordings_select ON room_recordings FOR SELECT
    USING (connect_auth.is_super_admin() OR connect_auth.is_room_member(room_id));
GRANT SELECT ON room_transcript_segments, room_recordings TO connect_app;

-- Adds one transcript segment. Only a host or co-host transcribes, so captions are the
-- teacher's words. The time is the client's, kept within the last ten minutes.
CREATE OR REPLACE FUNCTION connect_auth.transcript_add(
    p_room UUID, p_client_id TEXT, p_spoken_at TIMESTAMPTZ, p_body TEXT, p_lang TEXT, p_source TEXT
)
RETURNS BIGINT
SECURITY DEFINER SET search_path = pg_catalog, public, connect_auth
LANGUAGE plpgsql AS $$
DECLARE
    v_me TEXT := connect_auth.current_room_identity();
    v_name TEXT;
    v_now TIMESTAMPTZ := pg_catalog.clock_timestamp();
    v_seq BIGINT;
BEGIN
    IF NOT connect_auth.can_announce(p_room) THEN
        RAISE EXCEPTION 'only the host or a co-host can add to the transcript' USING ERRCODE = 'insufficient_privilege';
    END IF;
    SELECT p.display_name INTO v_name FROM public.room_participants p
    WHERE p.room_id = p_room AND p.identity = v_me ORDER BY p.joined_at DESC LIMIT 1;
    INSERT INTO public.room_transcript_segments AS t
        (room_id, speaker_identity, speaker_name, spoken_at, body, lang, source, client_segment_id)
    VALUES (p_room, v_me, COALESCE(v_name, 'Host'),
            LEAST(v_now, GREATEST(v_now - INTERVAL '10 minutes', COALESCE(p_spoken_at, v_now))),
            p_body, p_lang, p_source, p_client_id)
    ON CONFLICT (room_id, speaker_identity, client_segment_id) DO UPDATE SET body = t.body
    RETURNING seq INTO v_seq;
    RETURN v_seq;
END;
$$;
REVOKE ALL ON FUNCTION connect_auth.transcript_add(UUID, TEXT, TIMESTAMPTZ, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION connect_auth.transcript_add(UUID, TEXT, TIMESTAMPTZ, TEXT, TEXT, TEXT) TO connect_app;

CREATE OR REPLACE FUNCTION connect_auth.recording_save(
    p_room UUID, p_started TIMESTAMPTZ, p_ended TIMESTAMPTZ, p_file_name TEXT, p_markers JSONB
)
RETURNS UUID
SECURITY DEFINER SET search_path = pg_catalog, public, connect_auth
LANGUAGE plpgsql AS $$
DECLARE
    v_id UUID;
BEGIN
    IF NOT connect_auth.can_announce(p_room) THEN
        RAISE EXCEPTION 'only the host or a co-host can save a recording' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF p_ended > pg_catalog.clock_timestamp() + INTERVAL '5 minutes' THEN
        RAISE EXCEPTION 'a recording cannot end in the future' USING ERRCODE = 'CN422';
    END IF;
    INSERT INTO public.room_recordings (room_id, created_by, started_at, ended_at, file_name, markers)
    VALUES (p_room, connect_auth.current_user_id(), p_started, p_ended, p_file_name, COALESCE(p_markers, '[]'::jsonb))
    RETURNING id INTO v_id;
    RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION connect_auth.recording_save(UUID, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION connect_auth.recording_save(UUID, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, JSONB) TO connect_app;
