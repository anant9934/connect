-- ==============================================================================
-- Migration: 000021_polls_quizzes_doubts.sql
-- Polls and quizzes with server-side deadlines and scoring, and a queue of student doubts.
-- Answer keys live in their own table, so participants cannot read them while a quiz is open.
-- Rollback: tests/sql/rollback_000021.sql
-- ==============================================================================

INSERT INTO schema_metadata (version, description)
VALUES ('000021_polls_quizzes_doubts', 'Polls, quizzes and doubt management')
ON CONFLICT (version) DO NOTHING;

CREATE TABLE IF NOT EXISTS polls (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    room_id UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    created_by VARCHAR(128) NOT NULL,
    kind VARCHAR(8) NOT NULL DEFAULT 'poll',
    question TEXT NOT NULL,
    choice_mode VARCHAR(8) NOT NULL DEFAULT 'single',
    points INT NOT NULL DEFAULT 0,
    allow_change BOOLEAN NOT NULL DEFAULT false,
    live_results BOOLEAN NOT NULL DEFAULT true,
    closes_at TIMESTAMPTZ,
    closed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT ck_polls_kind CHECK (kind IN ('poll', 'quiz')),
    CONSTRAINT ck_polls_choice CHECK (choice_mode IN ('single', 'multiple')),
    CONSTRAINT ck_polls_question CHECK (char_length(question) BETWEEN 1 AND 500),
    CONSTRAINT ck_polls_points CHECK (points BETWEEN 0 AND 1000)
);

CREATE INDEX IF NOT EXISTS idx_polls_room ON polls(room_id, created_at);

CREATE TABLE IF NOT EXISTS poll_options (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    poll_id UUID NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
    position INT NOT NULL,
    label VARCHAR(200) NOT NULL,
    CONSTRAINT uq_poll_options_position UNIQUE (poll_id, position)
);

CREATE TABLE IF NOT EXISTS poll_answer_keys (
    poll_id UUID NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
    option_id UUID NOT NULL REFERENCES poll_options(id) ON DELETE CASCADE,
    PRIMARY KEY (poll_id, option_id)
);

CREATE TABLE IF NOT EXISTS poll_responses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    poll_id UUID NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
    identity VARCHAR(128) NOT NULL,
    option_ids UUID[] NOT NULL,
    score NUMERIC(8,2),
    submitted_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT uq_poll_responses_one UNIQUE (poll_id, identity)
);

CREATE TABLE IF NOT EXISTS meeting_doubts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    room_id UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    asked_by VARCHAR(128) NOT NULL,
    asked_by_name VARCHAR(100) NOT NULL,
    question TEXT NOT NULL,
    status VARCHAR(16) NOT NULL DEFAULT 'open',
    assigned_to VARCHAR(128),
    answer TEXT,
    answered_by VARCHAR(128),
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    answered_at TIMESTAMPTZ,
    resolved_at TIMESTAMPTZ,
    CONSTRAINT ck_doubts_status CHECK (status IN ('open', 'assigned', 'answered', 'resolved')),
    CONSTRAINT ck_doubts_question CHECK (char_length(question) BETWEEN 1 AND 1000),
    CONSTRAINT ck_doubts_answer CHECK (answer IS NULL OR char_length(answer) BETWEEN 1 AND 4000)
);

CREATE INDEX IF NOT EXISTS idx_meeting_doubts_room ON meeting_doubts(room_id, created_at);

ALTER TABLE polls ENABLE ROW LEVEL SECURITY;
ALTER TABLE polls FORCE ROW LEVEL SECURITY;
ALTER TABLE poll_options ENABLE ROW LEVEL SECURITY;
ALTER TABLE poll_options FORCE ROW LEVEL SECURITY;
ALTER TABLE poll_answer_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE poll_answer_keys FORCE ROW LEVEL SECURITY;
ALTER TABLE poll_responses ENABLE ROW LEVEL SECURITY;
ALTER TABLE poll_responses FORCE ROW LEVEL SECURITY;
ALTER TABLE meeting_doubts ENABLE ROW LEVEL SECURITY;
ALTER TABLE meeting_doubts FORCE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION connect_auth.poll_room(p_poll UUID)
RETURNS UUID
SECURITY DEFINER SET search_path = pg_catalog, public, connect_auth
LANGUAGE sql STABLE AS $$ SELECT room_id FROM public.polls WHERE id = p_poll $$;

REVOKE ALL ON FUNCTION connect_auth.poll_room(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION connect_auth.poll_room(UUID) TO connect_app, connect_worker;

CREATE POLICY rls_polls_select ON polls FOR SELECT USING (connect_auth.is_super_admin() OR connect_auth.can_use_room(room_id));
CREATE POLICY rls_polls_insert ON polls FOR INSERT WITH CHECK (connect_auth.can_announce(room_id) AND created_by = connect_auth.current_room_identity());
CREATE POLICY rls_polls_update ON polls FOR UPDATE USING (connect_auth.can_announce(room_id)) WITH CHECK (connect_auth.can_announce(room_id));

CREATE POLICY rls_poll_options_select ON poll_options FOR SELECT USING (connect_auth.can_use_room(connect_auth.poll_room(poll_id)));
CREATE POLICY rls_poll_options_insert ON poll_options FOR INSERT WITH CHECK (connect_auth.can_announce(connect_auth.poll_room(poll_id)));

-- Only those running the room read keys. Results reveal them after closing through poll_results.
CREATE POLICY rls_poll_keys_select ON poll_answer_keys FOR SELECT USING (connect_auth.can_announce(connect_auth.poll_room(poll_id)));
CREATE POLICY rls_poll_keys_insert ON poll_answer_keys FOR INSERT WITH CHECK (connect_auth.can_announce(connect_auth.poll_room(poll_id)));

-- Responses are written only by submit_poll_response. People read their own; moderators read all.
CREATE POLICY rls_poll_responses_select ON poll_responses FOR SELECT
    USING (identity = connect_auth.current_room_identity() OR connect_auth.can_announce(connect_auth.poll_room(poll_id)));

CREATE POLICY rls_doubts_select ON meeting_doubts FOR SELECT USING (connect_auth.is_super_admin() OR connect_auth.can_use_room(room_id));
CREATE POLICY rls_doubts_insert ON meeting_doubts FOR INSERT
    WITH CHECK (connect_auth.can_use_room(room_id) AND asked_by = connect_auth.current_room_identity() AND status = 'open');
CREATE POLICY rls_doubts_moderate ON meeting_doubts FOR UPDATE USING (connect_auth.can_announce(room_id)) WITH CHECK (connect_auth.can_announce(room_id));
-- The asker may mark their own doubt resolved, and only that; see the guard below.
CREATE POLICY rls_doubts_own ON meeting_doubts FOR UPDATE
    USING (asked_by = connect_auth.current_room_identity()) WITH CHECK (asked_by = connect_auth.current_room_identity());

CREATE OR REPLACE FUNCTION connect_auth.guard_doubt_update()
RETURNS TRIGGER
SET search_path = pg_catalog, public, connect_auth
LANGUAGE plpgsql AS $$
BEGIN
    IF CURRENT_USER = 'connect_app' AND NOT connect_auth.can_announce(OLD.room_id) AND (
        NEW.status <> 'resolved' OR NEW.question IS DISTINCT FROM OLD.question OR NEW.answer IS DISTINCT FROM OLD.answer
        OR NEW.assigned_to IS DISTINCT FROM OLD.assigned_to OR NEW.answered_by IS DISTINCT FROM OLD.answered_by
    ) THEN
        RAISE EXCEPTION 'only moderators may change this doubt' USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_guard_doubt_update BEFORE UPDATE ON meeting_doubts
    FOR EACH ROW EXECUTE FUNCTION connect_auth.guard_doubt_update();

GRANT EXECUTE ON FUNCTION connect_auth.guard_doubt_update() TO connect_app;

-- SQLSTATE CN410: closed or past the deadline. CN409: already answered. CN422: invalid choices.
-- The score is computed here, so nothing the client sends can affect it. For a quiz:
-- score = points x max(0, correct chosen - wrong chosen) / number of correct options.
CREATE OR REPLACE FUNCTION connect_auth.submit_poll_response(p_poll UUID, p_options UUID[])
RETURNS TABLE (score NUMERIC, changed BOOLEAN)
SECURITY DEFINER SET search_path = pg_catalog, public, connect_auth
LANGUAGE plpgsql AS $$
#variable_conflict use_column
DECLARE
    v_poll public.polls%ROWTYPE;
    v_identity TEXT := connect_auth.current_room_identity();
    v_valid INT;
    v_correct INT;
    v_right INT;
    v_score NUMERIC;
    v_existing UUID[];
    v_sorted UUID[] := ARRAY(SELECT DISTINCT unnest(p_options) ORDER BY 1);
BEGIN
    SELECT * INTO v_poll FROM public.polls WHERE id = p_poll FOR SHARE;
    IF NOT FOUND OR v_identity IS NULL OR NOT connect_auth.can_use_room(v_poll.room_id) THEN
        RAISE EXCEPTION 'not a participant' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF v_poll.closed_at IS NOT NULL OR (v_poll.closes_at IS NOT NULL AND pg_catalog.clock_timestamp() >= v_poll.closes_at) THEN
        RAISE EXCEPTION 'this question is closed' USING ERRCODE = 'CN410';
    END IF;
    SELECT count(*) INTO v_valid FROM public.poll_options o WHERE o.poll_id = p_poll AND o.id = ANY(v_sorted);
    IF COALESCE(array_length(v_sorted, 1), 0) = 0 OR v_valid <> array_length(v_sorted, 1)
       OR (v_poll.choice_mode = 'single' AND array_length(v_sorted, 1) <> 1) THEN
        RAISE EXCEPTION 'invalid choices' USING ERRCODE = 'CN422';
    END IF;

    IF v_poll.kind = 'quiz' THEN
        SELECT count(*), count(*) FILTER (WHERE k.option_id = ANY(v_sorted))
        INTO v_correct, v_right FROM public.poll_answer_keys k WHERE k.poll_id = p_poll;
        v_score := CASE WHEN v_correct = 0 THEN 0 ELSE round(
            v_poll.points * GREATEST(0, v_right - (array_length(v_sorted, 1) - v_right))::NUMERIC / v_correct, 2) END;
    END IF;

    SELECT r.option_ids INTO v_existing FROM public.poll_responses r
    WHERE r.poll_id = p_poll AND r.identity = v_identity FOR UPDATE;
    IF v_existing IS NOT NULL THEN
        -- A retry of the same answer succeeds, so a lost response is safe to resend.
        IF v_existing = v_sorted THEN
            RETURN QUERY SELECT r.score, false FROM public.poll_responses r WHERE r.poll_id = p_poll AND r.identity = v_identity;
            RETURN;
        END IF;
        IF NOT v_poll.allow_change THEN
            RAISE EXCEPTION 'you have already answered' USING ERRCODE = 'CN409';
        END IF;
        UPDATE public.poll_responses r SET option_ids = v_sorted, score = v_score, submitted_at = pg_catalog.clock_timestamp()
        WHERE r.poll_id = p_poll AND r.identity = v_identity;
        RETURN QUERY SELECT v_score, true;
        RETURN;
    END IF;

    INSERT INTO public.poll_responses (poll_id, identity, option_ids, score)
    VALUES (p_poll, v_identity, v_sorted, v_score)
    ON CONFLICT (poll_id, identity) DO NOTHING;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'you have already answered' USING ERRCODE = 'CN409';
    END IF;
    RETURN QUERY SELECT v_score, true;
END;
$$;

REVOKE ALL ON FUNCTION connect_auth.submit_poll_response(UUID, UUID[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION connect_auth.submit_poll_response(UUID, UUID[]) TO connect_app;

-- Per-option counts, and answer keys once closed, without exposing who chose what.
-- Moderators always see counts; others only with live results or after the question closes.
CREATE OR REPLACE FUNCTION connect_auth.poll_results(p_poll UUID)
RETURNS TABLE (option_id UUID, votes BIGINT, is_correct BOOLEAN)
SECURITY DEFINER SET search_path = pg_catalog, public, connect_auth
LANGUAGE plpgsql STABLE AS $$
#variable_conflict use_column
DECLARE
    v_poll public.polls%ROWTYPE;
    v_moderator BOOLEAN;
    v_closed BOOLEAN;
BEGIN
    SELECT * INTO v_poll FROM public.polls WHERE id = p_poll;
    IF NOT FOUND OR NOT connect_auth.can_use_room(v_poll.room_id) THEN
        RAISE EXCEPTION 'not a participant' USING ERRCODE = 'insufficient_privilege';
    END IF;
    v_moderator := connect_auth.can_announce(v_poll.room_id);
    v_closed := v_poll.closed_at IS NOT NULL OR (v_poll.closes_at IS NOT NULL AND pg_catalog.clock_timestamp() >= v_poll.closes_at);
    IF NOT (v_moderator OR v_closed OR v_poll.live_results) THEN
        RETURN;
    END IF;
    RETURN QUERY
    SELECT o.id,
           (SELECT count(*) FROM public.poll_responses r WHERE r.poll_id = p_poll AND o.id = ANY(r.option_ids)),
           CASE WHEN v_moderator OR v_closed THEN EXISTS (SELECT 1 FROM public.poll_answer_keys k WHERE k.option_id = o.id) END
    FROM public.poll_options o WHERE o.poll_id = p_poll ORDER BY o.position;
END;
$$;

REVOKE ALL ON FUNCTION connect_auth.poll_results(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION connect_auth.poll_results(UUID) TO connect_app;

GRANT SELECT, INSERT, UPDATE ON polls, meeting_doubts TO connect_app;
GRANT SELECT, INSERT ON poll_options, poll_answer_keys TO connect_app;
GRANT SELECT ON poll_responses TO connect_app;
REVOKE INSERT, UPDATE, DELETE ON poll_responses FROM connect_app;
REVOKE DELETE ON polls, meeting_doubts FROM connect_app;
REVOKE UPDATE, DELETE ON poll_options, poll_answer_keys FROM connect_app;
GRANT SELECT ON polls, poll_responses, meeting_doubts TO connect_worker;
CREATE POLICY rls_polls_worker ON polls FOR SELECT TO connect_worker USING (true);
CREATE POLICY rls_poll_responses_worker ON poll_responses FOR SELECT TO connect_worker USING (true);
CREATE POLICY rls_doubts_worker ON meeting_doubts FOR SELECT TO connect_worker USING (true);
