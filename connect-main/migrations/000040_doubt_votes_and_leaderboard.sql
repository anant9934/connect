-- ==============================================================================
-- Migration: 000040_doubt_votes_and_leaderboard.sql
-- Upvotes on the doubt queue, so the class's most shared questions rise to the top, and a quiz
-- leaderboard for the meeting: the top five by quiz points, plus the caller's own rank.
-- Rollback: tests/sql/rollback_000040.sql
-- ==============================================================================

INSERT INTO schema_metadata (version, description)
VALUES ('000040_doubt_votes_and_leaderboard', 'Doubt upvotes and quiz leaderboard')
ON CONFLICT (version) DO NOTHING;

CREATE TABLE IF NOT EXISTS doubt_votes (
    doubt_id UUID NOT NULL REFERENCES meeting_doubts(id) ON DELETE CASCADE,
    identity VARCHAR(128) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (doubt_id, identity)
);

ALTER TABLE doubt_votes ENABLE ROW LEVEL SECURITY;
ALTER TABLE doubt_votes FORCE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION connect_auth.doubt_room(p_doubt UUID)
RETURNS UUID
SECURITY DEFINER SET search_path = pg_catalog, public, connect_auth
LANGUAGE sql STABLE AS $$ SELECT d.room_id FROM public.meeting_doubts d WHERE d.id = p_doubt $$;
REVOKE ALL ON FUNCTION connect_auth.doubt_room(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION connect_auth.doubt_room(UUID) TO connect_app, connect_worker;

CREATE POLICY rls_doubt_votes_select ON doubt_votes FOR SELECT
    USING (connect_auth.is_super_admin() OR connect_auth.can_use_room(connect_auth.doubt_room(doubt_id)));
CREATE POLICY rls_doubt_votes_worker ON doubt_votes FOR SELECT TO connect_worker USING (true);
GRANT SELECT ON doubt_votes TO connect_app, connect_worker;

-- Adds or removes the caller's vote. Nobody votes on their own question.
CREATE OR REPLACE FUNCTION connect_auth.toggle_doubt_vote(p_doubt UUID)
RETURNS TABLE (voted BOOLEAN, votes INT)
SECURITY DEFINER SET search_path = pg_catalog, public, connect_auth
LANGUAGE plpgsql AS $$
DECLARE
    v_me TEXT := connect_auth.current_room_identity();
    v_room UUID;
    v_asker TEXT;
    v_status TEXT;
BEGIN
    SELECT d.room_id, d.asked_by, d.status INTO v_room, v_asker, v_status FROM public.meeting_doubts d WHERE d.id = p_doubt;
    IF v_room IS NULL OR NOT connect_auth.can_use_room(v_room) OR v_me IS NULL THEN
        RAISE EXCEPTION 'not permitted in this meeting' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF v_asker = v_me THEN
        RAISE EXCEPTION 'you cannot vote on your own question' USING ERRCODE = 'CN422';
    END IF;
    IF v_status = 'resolved' THEN
        RAISE EXCEPTION 'this question is resolved' USING ERRCODE = 'CN422';
    END IF;
    DELETE FROM public.doubt_votes v WHERE v.doubt_id = p_doubt AND v.identity = v_me;
    IF FOUND THEN
        voted := false;
    ELSE
        INSERT INTO public.doubt_votes (doubt_id, identity) VALUES (p_doubt, v_me);
        voted := true;
    END IF;
    SELECT count(*)::int INTO votes FROM public.doubt_votes v WHERE v.doubt_id = p_doubt;
    RETURN NEXT;
END;
$$;
REVOKE ALL ON FUNCTION connect_auth.toggle_doubt_vote(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION connect_auth.toggle_doubt_vote(UUID) TO connect_app;

-- Quiz points per participant in this meeting: the top five and the caller, with ranks.
-- Hosts and co-hosts are not ranked.
CREATE OR REPLACE FUNCTION connect_auth.quiz_leaderboard(p_room UUID)
RETURNS TABLE (rank INT, identity VARCHAR, display_name VARCHAR, points NUMERIC, answered INT, is_me BOOLEAN)
SECURITY DEFINER SET search_path = pg_catalog, public, connect_auth
LANGUAGE plpgsql STABLE AS $$
BEGIN
    IF NOT connect_auth.can_use_room(p_room) THEN
        RAISE EXCEPTION 'not permitted in this meeting' USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN QUERY
    WITH scores AS (
        SELECT pr.identity, COALESCE(sum(pr.score), 0) AS points, count(*)::int AS answered
        FROM public.poll_responses pr
        JOIN public.polls p ON p.id = pr.poll_id
        WHERE p.room_id = p_room AND p.kind = 'quiz'
          AND NOT connect_auth.is_room_moderator_identity(p_room, pr.identity)
        GROUP BY pr.identity
    ),
    ranked AS (
        SELECT (rank() OVER (ORDER BY s.points DESC))::int AS r, s.*,
               (SELECT rp.display_name FROM public.room_participants rp
                WHERE rp.room_id = p_room AND rp.identity = s.identity ORDER BY rp.joined_at DESC LIMIT 1) AS name
        FROM scores s
    )
    SELECT rk.r, rk.identity, COALESCE(rk.name, 'Participant')::varchar, rk.points, rk.answered,
           rk.identity = connect_auth.current_room_identity()
    FROM ranked rk
    WHERE rk.r <= 5 OR rk.identity = connect_auth.current_room_identity()
    ORDER BY rk.r, rk.name
    LIMIT 12;
END;
$$;
REVOKE ALL ON FUNCTION connect_auth.quiz_leaderboard(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION connect_auth.quiz_leaderboard(UUID) TO connect_app;
