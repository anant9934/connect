-- ==============================================================================
-- Migration: 000039_attendance_pillars.sql
-- One student's attendance for one meeting as three separate pillars, duration, active
-- engagement and tab focus, with the weights and score that combine them. Uses the stored
-- attendance calculation when the class has been finalised; otherwise it shows the live signals
-- and says that no rule has been applied yet. Functions only; no table changes.
-- Rollback: tests/sql/rollback_000039.sql
-- ==============================================================================

INSERT INTO schema_metadata (version, description)
VALUES ('000039_attendance_pillars', 'Duration, engagement and focus pillars per student')
ON CONFLICT (version) DO NOTHING;

-- The student sees their own; the room's host or co-host and the institution's overseers see anyone's.
CREATE OR REPLACE FUNCTION connect_auth.attendance_pillars(p_room UUID, p_student UUID)
RETURNS JSONB
SECURITY DEFINER SET search_path = pg_catalog, public, connect_auth
LANGUAGE plpgsql STABLE AS $$
DECLARE
    v_org UUID;
    v_session UUID;
    v_started TIMESTAMPTZ;
    v_ended TIMESTAMPTZ;
    v_live RECORD;
    v_record public.attendance_records%ROWTYPE;
    v_has BOOLEAN := false;
    v_sessions INT;
    v_calc JSONB;
BEGIN
    SELECT r.organization_id, r.class_session_id, r.started_at, r.ended_at INTO v_org, v_session, v_started, v_ended
    FROM public.rooms r WHERE r.id = p_room;
    IF NOT FOUND THEN
        RETURN NULL;
    END IF;
    IF NOT (p_student = connect_auth.current_user_id()
            OR connect_auth.can_announce(p_room)
            OR (v_org IS NOT NULL AND connect_auth.can_oversee_org(v_org))) THEN
        RAISE EXCEPTION 'not permitted to see this attendance' USING ERRCODE = 'insufficient_privilege';
    END IF;

    SELECT * INTO v_live FROM connect_auth.room_engagement_data(p_room) e WHERE e.user_id = p_student;

    -- Each join after the first is a reconnection. Prefer the LiveKit webhook's sessions.
    SELECT count(*) INTO v_sessions FROM public.participant_media_sessions pms
    JOIN public.rooms fam ON fam.id = pms.room_id
    WHERE (fam.id = p_room OR fam.parent_room_id = p_room) AND pms.user_id = p_student;
    IF v_sessions = 0 THEN
        SELECT count(*) INTO v_sessions FROM public.room_participants rp
        JOIN public.rooms fam ON fam.id = rp.room_id
        WHERE (fam.id = p_room OR fam.parent_room_id = p_room) AND rp.user_id = p_student;
    END IF;

    IF v_session IS NOT NULL THEN
        SELECT ar.* INTO v_record FROM public.attendance_records ar
        WHERE ar.class_session_id = v_session AND ar.student_user_id = p_student;
        v_has := FOUND;
    END IF;
    v_calc := CASE WHEN v_has THEN v_record.calculation END;

    RETURN jsonb_build_object(
        'finalized', v_has AND v_calc IS NOT NULL,
        'status', CASE WHEN v_has THEN v_record.attendance_status END,
        'score', CASE WHEN v_has THEN v_record.score END,
        'policyVersion', CASE WHEN v_has THEN v_record.policy_version END,
        'weights', CASE WHEN v_calc IS NULL THEN NULL ELSE jsonb_build_object(
            'duration', (v_calc->>'durationWeight')::numeric,
            'engagement', (v_calc->>'engagementWeight')::numeric,
            'focus', (v_calc->>'browserWeight')::numeric) END,
        'duration', jsonb_build_object(
            'firstJoinedAt', CASE WHEN v_has THEN v_record.first_joined_at END,
            'lastLeftAt', CASE WHEN v_has THEN v_record.last_left_at END,
            'connectedSeconds', COALESCE(CASE WHEN v_has THEN v_record.total_connected_seconds END, v_live.connected_seconds, 0),
            'sessionSeconds', COALESCE((v_calc->>'sessionSeconds')::int,
                GREATEST(0, EXTRACT(EPOCH FROM (COALESCE(v_ended, pg_catalog.clock_timestamp()) - v_started)))::int),
            'joins', v_sessions,
            'reconnections', GREATEST(v_sessions - 1, 0),
            'joinedLate', COALESCE(CASE WHEN v_has THEN v_record.joined_late END, false),
            'leftEarly', COALESCE(CASE WHEN v_has THEN v_record.left_early END, false),
            'ratio', CASE WHEN v_has THEN v_record.duration_ratio END),
        'engagement', jsonb_build_object(
            'pollsAnswered', COALESCE(v_live.polls_answered, 0), 'pollsTotal', COALESCE(v_live.polls_total, 0),
            'quizPoints', COALESCE(v_live.quiz_points, 0),
            'doubts', COALESCE(v_live.doubts, 0), 'messages', COALESCE(v_live.messages, 0),
            'hands', COALESCE(v_live.hands, 0), 'reactions', COALESCE(v_live.reactions, 0),
            'codingSubmitted', COALESCE(v_live.coding_submitted, 0), 'codingTotal', COALESCE(v_live.coding_total, 0),
            'liveScore', COALESCE(v_live.score, 0),
            'ratio', CASE WHEN v_has THEN v_record.engagement_ratio END),
        'focus', jsonb_build_object(
            'visibleSeconds', COALESCE(v_live.visible_seconds, 0), 'hiddenSeconds', COALESCE(v_live.hidden_seconds, 0),
            'reported', COALESCE(v_live.reported, false),
            'ratio', COALESCE(CASE WHEN v_has THEN v_record.browser_ratio END, v_live.focus_ratio))
    );
END;
$$;
REVOKE ALL ON FUNCTION connect_auth.attendance_pillars(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION connect_auth.attendance_pillars(UUID, UUID) TO connect_app;
