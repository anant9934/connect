-- ==============================================================================
-- Migration: 000009_background_jobs_outbox.sql
-- Stage C0 Remediation: Transactional Outbox Engine with Monotonic Fencing Leases
-- ==============================================================================

INSERT INTO schema_metadata (version, description)
VALUES ('000009_background_jobs_outbox', 'Transactional background jobs outbox with monotonic fencing leases and dead-letter queue')
ON CONFLICT (version) DO NOTHING;

CREATE TABLE IF NOT EXISTS background_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    queue VARCHAR(64) NOT NULL DEFAULT 'default',
    idempotency_key VARCHAR(128) NOT NULL UNIQUE,
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    status VARCHAR(32) NOT NULL DEFAULT 'pending', -- pending, processing, completed, failed, dead_letter
    attempt_count INT NOT NULL DEFAULT 0,
    max_attempts INT NOT NULL DEFAULT 5,
    scheduled_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    locked_by VARCHAR(128),
    locked_until TIMESTAMPTZ,
    fencing_token BIGINT NOT NULL DEFAULT 0,
    last_error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

-- Fast lookup indexes for lease claiming, polling, and stale lease harvesting
CREATE INDEX IF NOT EXISTS idx_background_jobs_polling
    ON background_jobs (queue, status, scheduled_at)
    WHERE status IN ('pending', 'failed');

CREATE INDEX IF NOT EXISTS idx_background_jobs_reap
    ON background_jobs (locked_until)
    WHERE status = 'processing';

-- Enforce Row-Level Security for system worker and application roles
ALTER TABLE background_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE background_jobs FORCE ROW LEVEL SECURITY;

-- Background jobs are managed exclusively by platform super admins and background worker
-- Read Access: Scoped strictly to super admin and background worker (application role cannot read queue)
CREATE POLICY rls_background_jobs_select ON background_jobs
    AS RESTRICTIVE FOR SELECT
    USING (
        connect_auth.is_super_admin() OR
        CURRENT_USER = 'connect_worker'
    );

-- Write/Enqueue Access: Allows application role and worker to enqueue pending jobs
CREATE POLICY rls_background_jobs_insert ON background_jobs
    AS RESTRICTIVE FOR INSERT
    WITH CHECK (
        connect_auth.is_super_admin() OR
        CURRENT_USER IN ('connect_worker', 'connect_app')
    );

-- Mutation / Lease Management Access: Exclusive to super admin and worker role
CREATE POLICY rls_background_jobs_mutation ON background_jobs
    AS RESTRICTIVE FOR UPDATE
    USING (
        connect_auth.is_super_admin() OR
        CURRENT_USER = 'connect_worker'
    )
    WITH CHECK (
        connect_auth.is_super_admin() OR
        CURRENT_USER = 'connect_worker'
    );

CREATE POLICY rls_background_jobs_delete ON background_jobs
    AS RESTRICTIVE FOR DELETE
    USING (
        connect_auth.is_super_admin() OR
        CURRENT_USER = 'connect_worker'
    );

CREATE POLICY rls_background_jobs_permit ON background_jobs
    AS PERMISSIVE USING (true)
    WITH CHECK (true);

-- Permissions
GRANT SELECT, INSERT, UPDATE, DELETE ON background_jobs TO connect_app, connect_worker;
