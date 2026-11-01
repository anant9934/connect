-- ==============================================================================
-- Migration: 000010_trusted_sessions_and_attendance_policies.sql
-- Server-trusted LiveKit connection history and versioned attendance policies.
-- Additive only. Rollback: DROP the three new tables and the policy_version column.
-- ==============================================================================

INSERT INTO schema_metadata (version, description)
VALUES ('000010_trusted_sessions_and_attendance_policies', 'LiveKit webhook ledger, participant media sessions and versioned attendance policies')
ON CONFLICT (version) DO NOTHING;

-- Delivery ledger: LiveKit retries webhooks, the event id makes processing idempotent.
CREATE TABLE IF NOT EXISTS livekit_webhook_events (
    event_id VARCHAR(128) PRIMARY KEY,
    event_type VARCHAR(64) NOT NULL,
    room_name VARCHAR(128) NOT NULL,
    received_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

-- One row per LiveKit connection. A reconnect receives a new SID, preserving full history.
CREATE TABLE IF NOT EXISTS participant_media_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    room_id UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    participant_sid VARCHAR(64) NOT NULL,
    identity VARCHAR(128) NOT NULL,
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    joined_at TIMESTAMPTZ NOT NULL,
    left_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT uq_media_sessions_sid UNIQUE (room_id, participant_sid),
    CONSTRAINT ck_media_sessions_timing CHECK (left_at IS NULL OR left_at >= joined_at)
);

CREATE INDEX IF NOT EXISTS idx_media_sessions_room_user ON participant_media_sessions(room_id, user_id);

-- Versions are append-only: a change inserts a new row, so past evaluations stay explainable.
CREATE TABLE IF NOT EXISTS attendance_policies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
    version INT NOT NULL,
    min_present_ratio NUMERIC(4,3) NOT NULL,
    min_partial_ratio NUMERIC(4,3) NOT NULL,
    late_grace_seconds INT,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT uq_attendance_policies_version UNIQUE (organization_id, version),
    CONSTRAINT ck_attendance_policies_version CHECK (version > 0),
    CONSTRAINT ck_attendance_policies_ratios CHECK (
        min_partial_ratio >= 0 AND min_partial_ratio <= min_present_ratio AND min_present_ratio <= 1
    ),
    CONSTRAINT ck_attendance_policies_grace CHECK (late_grace_seconds IS NULL OR late_grace_seconds >= 0)
);

-- NULL means the record was evaluated with the platform default policy.
ALTER TABLE attendance_records ADD COLUMN IF NOT EXISTS policy_version INT;

-- Service-only until a tenant-scoped API exists: end users have no read path yet.
ALTER TABLE livekit_webhook_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE livekit_webhook_events FORCE ROW LEVEL SECURITY;
ALTER TABLE participant_media_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE participant_media_sessions FORCE ROW LEVEL SECURITY;
ALTER TABLE attendance_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance_policies FORCE ROW LEVEL SECURITY;

CREATE POLICY rls_livekit_webhook_events_service ON livekit_webhook_events
    USING (connect_auth.is_super_admin() OR CURRENT_USER IN ('connect_app', 'connect_worker'))
    WITH CHECK (connect_auth.is_super_admin() OR CURRENT_USER IN ('connect_app', 'connect_worker'));

CREATE POLICY rls_participant_media_sessions_service ON participant_media_sessions
    USING (connect_auth.is_super_admin() OR CURRENT_USER IN ('connect_app', 'connect_worker'))
    WITH CHECK (connect_auth.is_super_admin() OR CURRENT_USER IN ('connect_app', 'connect_worker'));

CREATE POLICY rls_attendance_policies_service ON attendance_policies
    USING (connect_auth.is_super_admin() OR CURRENT_USER IN ('connect_app', 'connect_worker'))
    WITH CHECK (connect_auth.is_super_admin() OR CURRENT_USER IN ('connect_app', 'connect_worker'));

GRANT SELECT, INSERT, UPDATE ON livekit_webhook_events, participant_media_sessions TO connect_app, connect_worker;
GRANT SELECT, INSERT ON attendance_policies TO connect_app, connect_worker;
