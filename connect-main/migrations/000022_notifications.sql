-- ==============================================================================
-- Migration: 000022_notifications.sql
-- In-app notifications, created only by the worker. A dedupe key per user makes job retries
-- and duplicate delivery safe. People read and mark their own, and nothing else.
-- Rollback: tests/sql/rollback_000022.sql
-- ==============================================================================

INSERT INTO schema_metadata (version, description)
VALUES ('000022_notifications', 'In-app notifications with worker delivery')
ON CONFLICT (version) DO NOTHING;

CREATE TABLE IF NOT EXISTS notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    seq BIGINT GENERATED ALWAYS AS IDENTITY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
    kind VARCHAR(32) NOT NULL,
    title VARCHAR(200) NOT NULL,
    body TEXT NOT NULL DEFAULT '',
    link VARCHAR(300),
    dedupe_key VARCHAR(200) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    read_at TIMESTAMPTZ,
    CONSTRAINT uq_notifications_dedupe UNIQUE (user_id, dedupe_key)
);

CREATE INDEX IF NOT EXISTS idx_notifications_user_seq ON notifications(user_id, seq DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_unread ON notifications(user_id) WHERE read_at IS NULL;

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications FORCE ROW LEVEL SECURITY;

CREATE POLICY rls_notifications_select ON notifications FOR SELECT
    USING (user_id = connect_auth.current_user_id());
CREATE POLICY rls_notifications_update ON notifications FOR UPDATE
    USING (user_id = connect_auth.current_user_id()) WITH CHECK (user_id = connect_auth.current_user_id());
CREATE POLICY rls_notifications_worker ON notifications
    FOR ALL TO connect_worker USING (true) WITH CHECK (true);

GRANT SELECT ON notifications TO connect_app;
GRANT UPDATE (read_at) ON notifications TO connect_app;
REVOKE INSERT, DELETE ON notifications FROM connect_app;
GRANT SELECT, INSERT ON notifications TO connect_worker;

-- Scheduled enqueue for the API role, which may add jobs but not read the queue.
CREATE OR REPLACE FUNCTION connect_auth.enqueue_job_at(p_queue TEXT, p_key TEXT, p_payload JSONB, p_at TIMESTAMPTZ)
RETURNS VOID
SECURITY DEFINER SET search_path = pg_catalog, public, connect_auth
LANGUAGE sql AS $$
    INSERT INTO public.background_jobs (queue, idempotency_key, payload, status, scheduled_at)
    VALUES (p_queue, p_key, p_payload, 'pending', p_at)
    ON CONFLICT (idempotency_key) DO NOTHING
$$;

REVOKE ALL ON FUNCTION connect_auth.enqueue_job_at(TEXT, TEXT, JSONB, TIMESTAMPTZ) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION connect_auth.enqueue_job_at(TEXT, TEXT, JSONB, TIMESTAMPTZ) TO connect_app;

-- Everyone a class concerns: its enrolled students and the course's active faculty.
CREATE OR REPLACE FUNCTION connect_auth.notify_session_people(
    p_session UUID, p_kind TEXT, p_title TEXT, p_body TEXT, p_dedupe TEXT
)
RETURNS INT
SECURITY DEFINER SET search_path = pg_catalog, public, connect_auth
LANGUAGE plpgsql AS $$
DECLARE
    v_count INT;
BEGIN
    INSERT INTO public.notifications (user_id, organization_id, kind, title, body, link, dedupe_key)
    SELECT people.user_id, cs.organization_id, p_kind, p_title, p_body,
           (SELECT '/room/' || r.public_code || '/preview' FROM public.rooms r WHERE r.class_session_id = cs.id LIMIT 1),
           p_dedupe
    FROM public.class_sessions cs
    CROSS JOIN LATERAL (
        SELECT ce.student_user_id AS user_id FROM public.course_enrollments ce
        WHERE ce.batch_id = cs.batch_id AND ce.status = 'enrolled'
        UNION
        SELECT fa.faculty_user_id FROM public.faculty_allocations fa
        WHERE fa.course_id = cs.course_id AND fa.status = 'active'
    ) people
    WHERE cs.id = p_session
    ON CONFLICT (user_id, dedupe_key) DO NOTHING;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION connect_auth.notify_session_people(UUID, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION connect_auth.notify_session_people(UUID, TEXT, TEXT, TEXT, TEXT) TO connect_worker;
