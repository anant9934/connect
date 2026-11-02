-- ==============================================================================
-- Migration: 000025_attendance_signals.sql
-- Attendance rules for leaving early and weighted signals, with a stored explanation of every
-- result. Duration comes from trusted media sessions, engagement from what people did in the
-- meeting. Tab visibility is self-reported, so its weight is the institution's choice and it
-- counts for nothing by default.
-- Rollback: tests/sql/rollback_000025.sql
-- ==============================================================================

INSERT INTO schema_metadata (version, description)
VALUES ('000025_attendance_signals', 'Attendance rules, engagement and browser activity signals')
ON CONFLICT (version) DO NOTHING;

ALTER TABLE attendance_policies
    ADD COLUMN IF NOT EXISTS early_leave_grace_seconds INT,
    ADD COLUMN IF NOT EXISTS duration_weight NUMERIC(4,3) NOT NULL DEFAULT 1,
    ADD COLUMN IF NOT EXISTS engagement_weight NUMERIC(4,3) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS browser_weight NUMERIC(4,3) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS engagement_target INT NOT NULL DEFAULT 3;

ALTER TABLE attendance_policies
    ADD CONSTRAINT ck_attendance_policies_early CHECK (early_leave_grace_seconds IS NULL OR early_leave_grace_seconds >= 0),
    ADD CONSTRAINT ck_attendance_policies_weights CHECK (
        duration_weight >= 0 AND engagement_weight >= 0 AND browser_weight >= 0
        AND duration_weight + engagement_weight + browser_weight = 1
    ),
    ADD CONSTRAINT ck_attendance_policies_target CHECK (engagement_target > 0);

ALTER TABLE attendance_records
    ADD COLUMN IF NOT EXISTS first_joined_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS last_left_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS joined_late BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS left_early BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS duration_ratio NUMERIC(4,3),
    ADD COLUMN IF NOT EXISTS engagement_ratio NUMERIC(4,3),
    ADD COLUMN IF NOT EXISTS browser_ratio NUMERIC(4,3),
    ADD COLUMN IF NOT EXISTS score NUMERIC(4,3),
    ADD COLUMN IF NOT EXISTS calculation JSONB;

CREATE TABLE IF NOT EXISTS browser_activity (
    room_id UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    visible_seconds INT NOT NULL DEFAULT 0,
    hidden_seconds INT NOT NULL DEFAULT 0,
    last_report_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (room_id, user_id),
    CONSTRAINT ck_browser_activity_seconds CHECK (visible_seconds >= 0 AND hidden_seconds >= 0)
);

ALTER TABLE browser_activity ENABLE ROW LEVEL SECURITY;
ALTER TABLE browser_activity FORCE ROW LEVEL SECURITY;
CREATE POLICY rls_browser_activity_worker ON browser_activity FOR SELECT TO connect_worker USING (true);
GRANT SELECT ON browser_activity TO connect_worker;

-- Only classes record this, only for people connected to them, and reports can never claim more
-- time than has passed. Returns false where nothing is recorded, so the browser can stop.
CREATE OR REPLACE FUNCTION connect_auth.report_browser_activity(p_room UUID, p_visible INT, p_hidden INT)
RETURNS BOOLEAN
SECURITY DEFINER SET search_path = pg_catalog, public, connect_auth
LANGUAGE plpgsql AS $$
DECLARE
    v_user UUID := connect_auth.current_user_id();
    v_now TIMESTAMPTZ := pg_catalog.clock_timestamp();
    v_last TIMESTAMPTZ;
    v_allowed DOUBLE PRECISION;
    v_total INT := GREATEST(p_visible, 0) + GREATEST(p_hidden, 0);
    v_scale DOUBLE PRECISION := 1;
BEGIN
    IF v_user IS NULL OR NOT EXISTS (
        SELECT 1 FROM public.rooms r
        JOIN public.room_participants rp ON rp.room_id = r.id
        WHERE r.id = p_room AND r.class_session_id IS NOT NULL AND r.status = 'active'
          AND rp.identity = 'user:' || v_user::TEXT AND rp.left_at IS NULL AND NOT rp.is_removed
    ) THEN
        RETURN false;
    END IF;
    SELECT b.last_report_at INTO v_last FROM public.browser_activity b
    WHERE b.room_id = p_room AND b.user_id = v_user FOR UPDATE;
    v_allowed := CASE WHEN v_last IS NULL THEN 60 ELSE LEAST(EXTRACT(EPOCH FROM v_now - v_last) + 2, 300) END;
    IF v_total > v_allowed THEN
        v_scale := v_allowed / v_total;
    END IF;
    INSERT INTO public.browser_activity AS b (room_id, user_id, visible_seconds, hidden_seconds, last_report_at)
    VALUES (p_room, v_user, (GREATEST(p_visible, 0) * v_scale)::INT, (GREATEST(p_hidden, 0) * v_scale)::INT, v_now)
    ON CONFLICT (room_id, user_id) DO UPDATE SET
        visible_seconds = b.visible_seconds + EXCLUDED.visible_seconds,
        hidden_seconds = b.hidden_seconds + EXCLUDED.hidden_seconds,
        last_report_at = v_now;
    RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION connect_auth.report_browser_activity(UUID, INT, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION connect_auth.report_browser_activity(UUID, INT, INT) TO connect_app;

-- What each signed-in person did in the room. Not granted to connect_app: staff read it below.
CREATE OR REPLACE FUNCTION connect_auth.room_signals(p_room UUID)
RETURNS TABLE (user_id UUID, messages BIGINT, reactions BIGINT, hands BIGINT, poll_answers BIGINT, doubts BIGINT, visible_seconds INT, hidden_seconds INT, reported BOOLEAN)
SECURITY DEFINER SET search_path = pg_catalog, public, connect_auth
LANGUAGE sql STABLE AS $$
    WITH actions AS (
        SELECT m.sender_identity AS identity, 'message' AS kind FROM public.meeting_messages m WHERE m.room_id = p_room AND m.kind = 'chat'
        UNION ALL SELECT r.identity, 'reaction' FROM public.meeting_reactions r WHERE r.room_id = p_room
        UNION ALL SELECT h.identity, 'hand' FROM public.meeting_hand_raises h WHERE h.room_id = p_room
        UNION ALL SELECT pr.identity, 'poll' FROM public.poll_responses pr JOIN public.polls p ON p.id = pr.poll_id WHERE p.room_id = p_room
        UNION ALL SELECT d.asked_by, 'doubt' FROM public.meeting_doubts d WHERE d.room_id = p_room
    ),
    counted AS (
        SELECT substr(a.identity, 6)::UUID AS user_id,
               count(*) FILTER (WHERE a.kind = 'message') AS messages,
               count(*) FILTER (WHERE a.kind = 'reaction') AS reactions,
               count(*) FILTER (WHERE a.kind = 'hand') AS hands,
               count(*) FILTER (WHERE a.kind = 'poll') AS poll_answers,
               count(*) FILTER (WHERE a.kind = 'doubt') AS doubts
        FROM actions a WHERE a.identity LIKE 'user:%' GROUP BY 1
    )
    SELECT COALESCE(c.user_id, b.user_id), COALESCE(c.messages, 0), COALESCE(c.reactions, 0), COALESCE(c.hands, 0),
           COALESCE(c.poll_answers, 0), COALESCE(c.doubts, 0), COALESCE(b.visible_seconds, 0), COALESCE(b.hidden_seconds, 0), b.user_id IS NOT NULL
    FROM counted c
    FULL JOIN (SELECT * FROM public.browser_activity a WHERE a.room_id = p_room) b ON b.user_id = c.user_id
$$;

REVOKE ALL ON FUNCTION connect_auth.room_signals(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION connect_auth.room_signals(UUID) TO connect_worker;

-- Live or past engagement for a class, for those who teach or oversee it.
CREATE OR REPLACE FUNCTION connect_auth.session_engagement(p_session UUID)
RETURNS TABLE (user_id UUID, display_name VARCHAR, messages BIGINT, reactions BIGINT, hands BIGINT, poll_answers BIGINT, doubts BIGINT, visible_seconds INT, hidden_seconds INT, reported BOOLEAN)
SECURITY DEFINER SET search_path = pg_catalog, public, connect_auth
LANGUAGE plpgsql STABLE AS $$
DECLARE
    v_org UUID;
    v_room UUID;
BEGIN
    SELECT cs.organization_id, r.id INTO v_org, v_room
    FROM public.class_sessions cs LEFT JOIN public.rooms r ON r.class_session_id = cs.id
    WHERE cs.id = p_session;
    IF v_org IS NULL OR NOT (connect_auth.can_manage_session(p_session) OR connect_auth.can_oversee_org(v_org)) THEN
        RAISE EXCEPTION 'not permitted to view this class' USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN QUERY
    SELECT s.user_id, u.display_name, s.messages, s.reactions, s.hands, s.poll_answers, s.doubts, s.visible_seconds, s.hidden_seconds, s.reported
    FROM connect_auth.room_signals(v_room) s
    JOIN public.users u ON u.id = s.user_id
    ORDER BY u.display_name, s.user_id;
END;
$$;

REVOKE ALL ON FUNCTION connect_auth.session_engagement(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION connect_auth.session_engagement(UUID) TO connect_app;

-- The caller's own result and how it was reached.
CREATE OR REPLACE FUNCTION connect_auth.my_attendance_detail(p_room UUID)
RETURNS JSONB
SECURITY DEFINER SET search_path = pg_catalog, public, connect_auth
LANGUAGE sql STABLE AS $$
    SELECT jsonb_build_object(
        'status', ar.attendance_status, 'connectedSeconds', ar.total_connected_seconds,
        'joinedLate', ar.joined_late, 'leftEarly', ar.left_early,
        'firstJoinedAt', ar.first_joined_at, 'lastLeftAt', ar.last_left_at,
        'durationRatio', ar.duration_ratio, 'engagementRatio', ar.engagement_ratio, 'browserRatio', ar.browser_ratio,
        'score', ar.score, 'policyVersion', ar.policy_version, 'calculation', ar.calculation,
        'isOverruled', ar.is_overruled, 'originalStatus', ar.original_status, 'overruleReason', ar.overrule_reason)
    FROM public.attendance_records ar
    JOIN public.rooms r ON r.class_session_id = ar.class_session_id
    WHERE r.id = p_room AND ar.student_user_id = connect_auth.current_user_id()
$$;

REVOKE ALL ON FUNCTION connect_auth.my_attendance_detail(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION connect_auth.my_attendance_detail(UUID) TO connect_app;
