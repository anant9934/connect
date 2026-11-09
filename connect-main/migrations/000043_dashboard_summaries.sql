-- ==============================================================================
-- Migration: 000043_dashboard_summaries.sql
-- Numbers for two dashboards. my_meeting_summary: the caller's own classes, time in class,
-- resolved questions and saved material. org_system_health: an institution's live rooms,
-- members, AI token use this month and file storage, for its administrators and auditors;
-- platform super admins also see database size and the largest tables. Functions only.
-- Rollback: tests/sql/rollback_000043.sql
-- ==============================================================================

INSERT INTO schema_metadata (version, description)
VALUES ('000043_dashboard_summaries', 'History summary and institution health figures')
ON CONFLICT (version) DO NOTHING;

CREATE OR REPLACE FUNCTION connect_auth.my_meeting_summary()
RETURNS JSONB
SECURITY DEFINER SET search_path = pg_catalog, public, connect_auth
LANGUAGE sql STABLE AS $$
    WITH me AS (SELECT connect_auth.current_user_id() AS id),
    mine AS (
        SELECT DISTINCT r.id FROM public.rooms r, me
        WHERE me.id IS NOT NULL AND (r.host_user_id = me.id
            OR EXISTS (SELECT 1 FROM public.room_participants p WHERE p.room_id = r.id AND p.user_id = me.id))
    ),
    -- Time per meeting the caller attended, from join and leave times.
    attended AS (
        SELECT p.room_id, sum(EXTRACT(EPOCH FROM (p.left_at - p.joined_at))) AS seconds
        FROM public.room_participants p, me
        WHERE p.user_id = me.id AND p.left_at IS NOT NULL AND p.left_at > p.joined_at
        GROUP BY p.room_id
    )
    SELECT jsonb_build_object(
        'meetings', (SELECT count(*) FROM mine),
        'ended', (SELECT count(*) FROM public.rooms r WHERE r.id IN (SELECT id FROM mine) AND r.status = 'ended'),
        'upcoming', (SELECT count(*) FROM public.rooms r WHERE r.id IN (SELECT id FROM mine) AND r.status = 'scheduled'),
        'avgMinutes', COALESCE((SELECT round(avg(seconds) / 60) FROM attended), 0),
        'doubtsResolved', (SELECT count(*) FROM public.meeting_doubts d WHERE d.room_id IN (SELECT id FROM mine) AND d.status = 'resolved'),
        'doubtsOpen', (SELECT count(*) FROM public.meeting_doubts d WHERE d.room_id IN (SELECT id FROM mine) AND d.status <> 'resolved'),
        'savedDecks', (SELECT count(*) FROM public.room_saved_decks s WHERE s.room_id IN (SELECT id FROM mine)),
        'recordings', (SELECT count(*) FROM public.room_recordings x WHERE x.room_id IN (SELECT id FROM mine)),
        'transcribed', (SELECT count(DISTINCT t.room_id) FROM public.room_transcript_segments t WHERE t.room_id IN (SELECT id FROM mine))
    )
$$;
REVOKE ALL ON FUNCTION connect_auth.my_meeting_summary() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION connect_auth.my_meeting_summary() TO connect_app;

CREATE OR REPLACE FUNCTION connect_auth.org_system_health(p_org UUID)
RETURNS JSONB
SECURITY DEFINER SET search_path = pg_catalog, public, connect_auth
LANGUAGE plpgsql STABLE AS $$
DECLARE
    v_month TIMESTAMPTZ := date_trunc('month', pg_catalog.clock_timestamp());
    v_out JSONB;
BEGIN
    IF NOT connect_auth.can_oversee_org(p_org) THEN
        RAISE EXCEPTION 'only institution administrators and auditors can see this' USING ERRCODE = 'insufficient_privilege';
    END IF;
    SELECT jsonb_build_object(
        'activeRooms', (SELECT count(*) FROM public.rooms r WHERE r.organization_id = p_org AND r.status = 'active'),
        'scheduledRooms', (SELECT count(*) FROM public.rooms r WHERE r.organization_id = p_org AND r.status = 'scheduled'),
        'peopleInClassNow', (SELECT count(*) FROM public.room_participants p JOIN public.rooms r ON r.id = p.room_id
                             WHERE r.organization_id = p_org AND r.status = 'active' AND p.left_at IS NULL),
        'members', (SELECT count(*) FROM public.organization_memberships m WHERE m.organization_id = p_org AND m.status = 'active'),
        'courses', (SELECT count(*) FROM public.courses c WHERE c.organization_id = p_org),
        'classSessions', (SELECT count(*) FROM public.class_sessions s WHERE s.organization_id = p_org),
        'attendanceRecords', (SELECT count(*) FROM public.attendance_records a WHERE a.organization_id = p_org),
        'aiRequestsThisMonth', (SELECT count(*) FROM public.ai_usage_ledger u WHERE u.organization_id = p_org AND u.created_at >= v_month),
        'aiTokensThisMonth', (SELECT COALESCE(sum(u.total_tokens), 0) FROM public.ai_usage_ledger u WHERE u.organization_id = p_org AND u.created_at >= v_month),
        'aiBilledMicroUsdThisMonth', (SELECT COALESCE(sum(u.billed_cost_micro_usd), 0) FROM public.ai_usage_ledger u WHERE u.organization_id = p_org AND u.created_at >= v_month),
        'aiMonthlyBudgetMicroUsd', (SELECT p.monthly_budget_micro_usd FROM public.ai_organization_policies p WHERE p.organization_id = p_org),
        'files', (SELECT count(*) FROM public.meeting_files f JOIN public.rooms r ON r.id = f.room_id WHERE r.organization_id = p_org AND f.scan_status <> 'deleted'),
        'storageBytes', (SELECT COALESCE(sum(f.size_bytes), 0) FROM public.meeting_files f JOIN public.rooms r ON r.id = f.room_id WHERE r.organization_id = p_org AND f.scan_status <> 'deleted'),
        'transcriptLines', (SELECT count(*) FROM public.room_transcript_segments t JOIN public.rooms r ON r.id = t.room_id WHERE r.organization_id = p_org),
        'recordings', (SELECT count(*) FROM public.room_recordings x JOIN public.rooms r ON r.id = x.room_id WHERE r.organization_id = p_org)
    ) INTO v_out;
    IF connect_auth.is_super_admin() THEN
        v_out := v_out || jsonb_build_object(
            'databaseBytes', pg_catalog.pg_database_size(pg_catalog.current_database()),
            'largestTables', (SELECT COALESCE(jsonb_agg(jsonb_build_object('table', t.relname, 'rows', t.rows, 'bytes', t.bytes)), '[]'::jsonb) FROM (
                SELECT c.relname, GREATEST(c.reltuples, 0)::bigint AS rows, pg_catalog.pg_total_relation_size(c.oid) AS bytes
                FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
                WHERE n.nspname = 'public' AND c.relkind = 'r'
                ORDER BY pg_catalog.pg_total_relation_size(c.oid) DESC LIMIT 8) t));
    END IF;
    RETURN v_out;
END;
$$;
REVOKE ALL ON FUNCTION connect_auth.org_system_health(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION connect_auth.org_system_health(UUID) TO connect_app;
