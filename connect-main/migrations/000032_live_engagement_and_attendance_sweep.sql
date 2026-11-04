-- 000032: live engagement scores and automatic attendance finalisation.
-- Adds functions only. No table, column or data changes.

-- In-class coding problems are announced by a host or co-host as an announcement whose body
-- starts with [[tc-coding:<org>:<assignment>]] (the API only lets moderators post announcements).
CREATE OR REPLACE FUNCTION connect_auth.room_coding_assignments(p_room UUID)
RETURNS TABLE (assignment_id UUID)
SECURITY DEFINER SET search_path = pg_catalog, public, connect_auth
LANGUAGE sql STABLE AS $$
    SELECT DISTINCT (regexp_match(m.body, '^\[\[tc-coding:[0-9a-fA-F-]{36}:([0-9a-fA-F-]{36})\]\]'))[1]::UUID
    FROM public.meeting_messages m
    JOIN public.rooms family ON family.id = m.room_id
    WHERE (family.id = p_room OR family.parent_room_id = p_room)
      AND m.kind = 'announcement'
      AND m.body ~ '^\[\[tc-coding:[0-9a-fA-F-]{36}:[0-9a-fA-F-]{36}\]\]'
$$;

REVOKE ALL ON FUNCTION connect_auth.room_coding_assignments(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION connect_auth.room_coding_assignments(UUID) TO connect_worker;

-- Per-student engagement for a room and its breakout rooms, with a 0-100 score.
-- Unchecked: callers are the worker or the permission-checked wrappers below.
--
-- Score = weighted average of the components that apply to this class:
--   polls       35%  polls and quizzes answered / asked          (skipped if none were asked)
--   coding      25%  in-class coding problems submitted / given  (skipped if none were given)
--   interaction 20%  min((messages + hands + doubts + reactions/2) / 3, 1)
--   focus       20%  tab visible time / reported time            (skipped if never reported)
-- Someone who never connected and did nothing scores 0. Hosts and co-hosts are not scored.
-- It measures activity, not attention.
CREATE OR REPLACE FUNCTION connect_auth.room_engagement_data(p_room UUID)
RETURNS TABLE (
    user_id UUID, display_name VARCHAR, present BOOLEAN, connected_seconds INT,
    messages INT, reactions INT, hands INT, doubts INT,
    polls_total INT, polls_answered INT, quiz_points NUMERIC,
    coding_total INT, coding_submitted INT,
    visible_seconds INT, hidden_seconds INT, reported BOOLEAN,
    polls_ratio NUMERIC, coding_ratio NUMERIC, interaction_ratio NUMERIC, focus_ratio NUMERIC,
    score INT
)
SECURITY DEFINER SET search_path = pg_catalog, public, connect_auth
LANGUAGE sql STABLE AS $$
    WITH main AS (
        SELECT r.id, r.organization_id, r.class_session_id FROM public.rooms r WHERE r.id = p_room
    ),
    family AS (
        SELECT r.id FROM public.rooms r WHERE r.id = p_room OR r.parent_room_id = p_room
    ),
    -- Like the attendance worker, prefer LiveKit webhook sessions (exact, closed when the room
    -- finishes) and fall back to the API's own join records for rooms with no webhook data.
    joins AS (
        SELECT pms.user_id, pms.identity, pms.joined_at, pms.left_at
        FROM public.participant_media_sessions pms
        WHERE pms.room_id IN (SELECT id FROM family) AND pms.user_id IS NOT NULL
        UNION ALL
        SELECT rp.user_id, rp.identity, rp.joined_at, rp.left_at
        FROM public.room_participants rp
        WHERE rp.room_id IN (SELECT id FROM family) AND rp.user_id IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM public.participant_media_sessions w WHERE w.room_id IN (SELECT id FROM family))
    ),
    staff AS (
        SELECT DISTINCT j.user_id FROM joins j
        WHERE connect_auth.room_access_role(p_room, j.identity) IN ('host', 'co-host')
    ),
    people AS (
        SELECT j.user_id FROM joins j
        UNION
        SELECT ce.student_user_id
        FROM main
        JOIN public.class_sessions cs ON cs.id = main.class_session_id
        JOIN public.course_enrollments ce ON ce.organization_id = cs.organization_id AND ce.batch_id = cs.batch_id
        WHERE ce.status IN ('enrolled', 'completed')
    ),
    browser AS (
        SELECT ba.user_id, sum(ba.visible_seconds)::INT AS vis, sum(ba.hidden_seconds)::INT AS hid, max(ba.last_report_at) AS last_report
        FROM public.browser_activity ba
        WHERE ba.room_id IN (SELECT id FROM family)
        GROUP BY 1
    ),
    -- A join with no leave is still open, or its browser crashed. Like the attendance worker, it
    -- ends at the earliest of now, the same person's next join, and their last heartbeat plus 60s
    -- when that heartbeat belongs to this join. Without a heartbeat (e.g. the mobile app) it runs to now.
    spans AS (
        SELECT j.user_id, j.joined_at AS s,
               GREATEST(j.joined_at, COALESCE(j.left_at, LEAST(
                   clock_timestamp(),
                   COALESCE(lead(j.joined_at) OVER (PARTITION BY j.user_id ORDER BY j.joined_at), clock_timestamp()),
                   CASE WHEN b.last_report >= j.joined_at THEN b.last_report + interval '60 seconds' ELSE clock_timestamp() END
               ))) AS e
        FROM joins j
        LEFT JOIN browser b ON b.user_id = j.user_id
    ),
    -- Merge overlapping intervals (rejoins, two tabs) before summing time.
    ordered AS (
        SELECT sp.user_id, sp.s, sp.e,
               max(sp.e) OVER (PARTITION BY sp.user_id ORDER BY sp.s, sp.e ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING) AS prev_max
        FROM spans sp
    ),
    islands AS (
        SELECT o.user_id, o.s, o.e,
               sum(CASE WHEN o.prev_max IS NULL OR o.s > o.prev_max THEN 1 ELSE 0 END) OVER (PARTITION BY o.user_id ORDER BY o.s, o.e) AS grp
        FROM ordered o
    ),
    presence AS (
        SELECT x.user_id, sum(EXTRACT(EPOCH FROM (x.ie - x.isx)))::INT AS connected_seconds
        FROM (SELECT i.user_id, i.grp, min(i.s) AS isx, max(i.e) AS ie FROM islands i GROUP BY i.user_id, i.grp) x
        GROUP BY x.user_id
    ),
    open_join AS (
        SELECT j.user_id, bool_or(j.left_at IS NULL) AS has_open FROM joins j GROUP BY j.user_id
    ),
    acts AS (
        SELECT substr(a.identity, 6)::UUID AS user_id,
               count(*) FILTER (WHERE a.kind = 'message')::INT AS messages,
               count(*) FILTER (WHERE a.kind = 'reaction')::INT AS reactions,
               count(*) FILTER (WHERE a.kind = 'hand')::INT AS hands,
               count(*) FILTER (WHERE a.kind = 'doubt')::INT AS doubts
        FROM (
            SELECT m.sender_identity AS identity, 'message' AS kind FROM public.meeting_messages m
            WHERE m.room_id IN (SELECT id FROM family) AND m.kind = 'chat'
            UNION ALL SELECT r.identity, 'reaction' FROM public.meeting_reactions r WHERE r.room_id IN (SELECT id FROM family)
            UNION ALL SELECT h.identity, 'hand' FROM public.meeting_hand_raises h WHERE h.room_id IN (SELECT id FROM family)
            UNION ALL SELECT d.asked_by, 'doubt' FROM public.meeting_doubts d WHERE d.room_id IN (SELECT id FROM family)
        ) a
        WHERE a.identity ~ '^user:[0-9a-fA-F-]{36}$'
        GROUP BY 1
    ),
    poll_set AS (
        SELECT p.id FROM public.polls p WHERE p.room_id IN (SELECT id FROM family)
    ),
    answers AS (
        SELECT substr(pr.identity, 6)::UUID AS user_id, count(DISTINCT pr.poll_id)::INT AS answered, COALESCE(sum(pr.score), 0) AS points
        FROM public.poll_responses pr
        WHERE pr.poll_id IN (SELECT id FROM poll_set) AND pr.identity ~ '^user:[0-9a-fA-F-]{36}$'
        GROUP BY 1
    ),
    coding AS (
        SELECT ca.assignment_id
        FROM connect_auth.room_coding_assignments(p_room) ca
        JOIN public.lab_assignments la ON la.id = ca.assignment_id
        JOIN main ON la.organization_id = main.organization_id
    ),
    submissions AS (
        SELECT ls.student_user_id AS user_id, count(DISTINCT ls.assignment_id)::INT AS submitted
        FROM public.lab_submissions ls
        WHERE ls.assignment_id IN (SELECT assignment_id FROM coding)
        GROUP BY 1
    ),
    base AS (
        SELECT p.user_id, u.display_name,
               -- An open join is present unless its browser has stopped reporting (a crash). Clients
               -- that never report, such as the mobile app, are present while their join is open.
               COALESCE(oj.has_open, false) AND (b.last_report IS NULL OR b.last_report > clock_timestamp() - interval '2 minutes') AS present,
               COALESCE(pr.connected_seconds, 0) AS connected_seconds,
               COALESCE(a.messages, 0) AS messages, COALESCE(a.reactions, 0) AS reactions,
               COALESCE(a.hands, 0) AS hands, COALESCE(a.doubts, 0) AS doubts,
               (SELECT count(*)::INT FROM poll_set) AS polls_total,
               COALESCE(an.answered, 0) AS polls_answered, COALESCE(an.points, 0) AS quiz_points,
               (SELECT count(*)::INT FROM coding) AS coding_total,
               COALESCE(s.submitted, 0) AS coding_submitted,
               COALESCE(b.vis, 0) AS visible_seconds, COALESCE(b.hid, 0) AS hidden_seconds,
               b.user_id IS NOT NULL AS reported
        FROM people p
        JOIN public.users u ON u.id = p.user_id
        LEFT JOIN presence pr ON pr.user_id = p.user_id
        LEFT JOIN open_join oj ON oj.user_id = p.user_id
        LEFT JOIN acts a ON a.user_id = p.user_id
        LEFT JOIN answers an ON an.user_id = p.user_id
        LEFT JOIN submissions s ON s.user_id = p.user_id
        LEFT JOIN browser b ON b.user_id = p.user_id
        WHERE p.user_id NOT IN (SELECT st.user_id FROM staff st)
    ),
    ratios AS (
        SELECT base.*,
               CASE WHEN base.polls_total > 0 THEN LEAST(base.polls_answered::NUMERIC / base.polls_total, 1) END AS pr_ratio,
               CASE WHEN base.coding_total > 0 THEN LEAST(base.coding_submitted::NUMERIC / base.coding_total, 1) END AS cr_ratio,
               LEAST((base.messages + base.hands + base.doubts + base.reactions * 0.5) / 3.0, 1) AS ir_ratio,
               CASE WHEN base.reported AND base.visible_seconds + base.hidden_seconds > 0
                    THEN base.visible_seconds::NUMERIC / (base.visible_seconds + base.hidden_seconds) END AS fr_ratio
        FROM base
    )
    SELECT r.user_id, r.display_name, r.present, r.connected_seconds,
           r.messages, r.reactions, r.hands, r.doubts,
           r.polls_total, r.polls_answered, r.quiz_points,
           r.coding_total, r.coding_submitted,
           r.visible_seconds, r.hidden_seconds, r.reported,
           round(r.pr_ratio, 3), round(r.cr_ratio, 3), round(r.ir_ratio, 3), round(r.fr_ratio, 3),
           CASE
               WHEN r.connected_seconds = 0 AND r.messages + r.reactions + r.hands + r.doubts + r.polls_answered + r.coding_submitted = 0 THEN 0
               ELSE round(100 * (0.35 * COALESCE(r.pr_ratio, 0) + 0.25 * COALESCE(r.cr_ratio, 0) + 0.20 * r.ir_ratio + 0.20 * COALESCE(r.fr_ratio, 0))
                    / (CASE WHEN r.pr_ratio IS NULL THEN 0 ELSE 0.35 END + CASE WHEN r.cr_ratio IS NULL THEN 0 ELSE 0.25 END
                       + 0.20 + CASE WHEN r.fr_ratio IS NULL THEN 0 ELSE 0.20 END))::INT
           END
    FROM ratios r
    ORDER BY 21, r.display_name
$$;

REVOKE ALL ON FUNCTION connect_auth.room_engagement_data(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION connect_auth.room_engagement_data(UUID) TO connect_worker;

-- Live engagement for a meeting: its host or co-hosts, the class's teachers, or institution overseers.
CREATE OR REPLACE FUNCTION connect_auth.room_engagement(p_room UUID)
RETURNS TABLE (
    user_id UUID, display_name VARCHAR, present BOOLEAN, connected_seconds INT,
    messages INT, reactions INT, hands INT, doubts INT,
    polls_total INT, polls_answered INT, quiz_points NUMERIC,
    coding_total INT, coding_submitted INT,
    visible_seconds INT, hidden_seconds INT, reported BOOLEAN,
    polls_ratio NUMERIC, coding_ratio NUMERIC, interaction_ratio NUMERIC, focus_ratio NUMERIC,
    score INT
)
SECURITY DEFINER SET search_path = pg_catalog, public, connect_auth
LANGUAGE plpgsql STABLE AS $$
DECLARE
    v_uid UUID := connect_auth.current_user_id();
    v_org UUID;
    v_session UUID;
    v_found BOOLEAN;
BEGIN
    SELECT true, r.organization_id, r.class_session_id INTO v_found, v_org, v_session FROM public.rooms r WHERE r.id = p_room;
    IF v_uid IS NULL OR v_found IS NULL OR NOT (
        connect_auth.room_access_role(p_room, 'user:' || v_uid::TEXT) IN ('host', 'co-host')
        OR (v_session IS NOT NULL AND connect_auth.can_manage_session(v_session))
        OR (v_org IS NOT NULL AND connect_auth.can_oversee_org(v_org))
    ) THEN
        RAISE EXCEPTION 'not permitted to view engagement for this meeting' USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN QUERY SELECT * FROM connect_auth.room_engagement_data(p_room);
END;
$$;

REVOKE ALL ON FUNCTION connect_auth.room_engagement(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION connect_auth.room_engagement(UUID) TO connect_app;

-- Engagement for a scheduled class, for its teachers and institution overseers.
CREATE OR REPLACE FUNCTION connect_auth.session_engagement_scores(p_session UUID)
RETURNS TABLE (
    user_id UUID, display_name VARCHAR, present BOOLEAN, connected_seconds INT,
    messages INT, reactions INT, hands INT, doubts INT,
    polls_total INT, polls_answered INT, quiz_points NUMERIC,
    coding_total INT, coding_submitted INT,
    visible_seconds INT, hidden_seconds INT, reported BOOLEAN,
    polls_ratio NUMERIC, coding_ratio NUMERIC, interaction_ratio NUMERIC, focus_ratio NUMERIC,
    score INT
)
SECURITY DEFINER SET search_path = pg_catalog, public, connect_auth
LANGUAGE plpgsql STABLE AS $$
DECLARE
    v_org UUID;
    v_room UUID;
BEGIN
    SELECT cs.organization_id, r.id INTO v_org, v_room
    FROM public.class_sessions cs
    LEFT JOIN public.rooms r ON r.class_session_id = cs.id AND r.parent_room_id IS NULL
    WHERE cs.id = p_session;
    IF v_org IS NULL OR NOT (connect_auth.can_manage_session(p_session) OR connect_auth.can_oversee_org(v_org)) THEN
        RAISE EXCEPTION 'not permitted to view this class' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF v_room IS NULL THEN
        RETURN;
    END IF;
    RETURN QUERY SELECT * FROM connect_auth.room_engagement_data(v_room);
END;
$$;

REVOKE ALL ON FUNCTION connect_auth.session_engagement_scores(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION connect_auth.session_engagement_scores(UUID) TO connect_app;

-- Classes whose attendance should now be calculated: ended (plus grace), not cancelled, not yet
-- final, and either quiet (no browser has reported for 3 minutes) or 4 hours past their end.
-- p_not_before skips classes that ended before automatic finalisation existed, so their
-- existing records are left exactly as they are.
CREATE OR REPLACE FUNCTION connect_auth.attendance_due_sessions(p_grace_seconds INT, p_not_before TIMESTAMPTZ)
RETURNS TABLE (room_id UUID, class_session_id UUID)
SECURITY DEFINER SET search_path = pg_catalog, public, connect_auth
LANGUAGE sql STABLE AS $$
    SELECT r.id, cs.id
    FROM public.class_sessions cs
    JOIN public.rooms r ON r.class_session_id = cs.id AND r.parent_room_id IS NULL
    WHERE cs.status <> 'cancelled'
      AND NOT cs.attendance_finalized
      AND cs.scheduled_end >= p_not_before
      AND cs.scheduled_end + make_interval(secs => p_grace_seconds) < clock_timestamp()
      AND (
          cs.scheduled_end + interval '4 hours' < clock_timestamp()
          OR NOT EXISTS (
              SELECT 1 FROM public.browser_activity ba
              JOIN public.rooms f ON f.id = ba.room_id
              WHERE (f.id = r.id OR f.parent_room_id = r.id)
                AND ba.last_report_at > clock_timestamp() - interval '3 minutes'
          )
      )
    ORDER BY cs.scheduled_end
    LIMIT 50
$$;

REVOKE ALL ON FUNCTION connect_auth.attendance_due_sessions(INT, TIMESTAMPTZ) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION connect_auth.attendance_due_sessions(INT, TIMESTAMPTZ) TO connect_worker;

-- Marks a class's attendance as calculated, after the worker has written its records.
CREATE OR REPLACE FUNCTION connect_auth.mark_attendance_finalized(p_session UUID)
RETURNS VOID
SECURITY DEFINER SET search_path = pg_catalog, public, connect_auth
LANGUAGE sql AS $$
    UPDATE public.class_sessions SET attendance_finalized = true WHERE id = p_session AND NOT attendance_finalized
$$;

REVOKE ALL ON FUNCTION connect_auth.mark_attendance_finalized(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION connect_auth.mark_attendance_finalized(UUID) TO connect_worker;
