-- ==============================================================================
-- Migration: 000006_participant_distributed_locks.sql
-- Stage B: PostgreSQL-Backed Distributed Leases for Cross-Instance Serialization
-- ==============================================================================

-- Track schema version
INSERT INTO schema_metadata (version, description)
VALUES ('000006_participant_distributed_locks', 'Distributed participant lease table and fencing generations for multi-instance mutation serialization')
ON CONFLICT (version) DO NOTHING;

-- Participant Locks Table
CREATE TABLE IF NOT EXISTS participant_locks (
    lock_key VARCHAR(128) PRIMARY KEY,
    owner_id VARCHAR(64) NOT NULL,
    lease_token VARCHAR(64) NOT NULL,
    generation BIGINT NOT NULL DEFAULT 1,
    acquired_at TIMESTAMPTZ NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL
);

-- Idempotent column additions if table was created in an earlier partial run
ALTER TABLE participant_locks ADD COLUMN IF NOT EXISTS lease_token VARCHAR(64) NOT NULL DEFAULT '';
ALTER TABLE participant_locks ADD COLUMN IF NOT EXISTS generation BIGINT NOT NULL DEFAULT 1;

CREATE INDEX IF NOT EXISTS idx_participant_locks_expires_at ON participant_locks(expires_at);

-- Participant Transition State and Monotonic Fencing Columns
ALTER TABLE room_participants
    ADD COLUMN IF NOT EXISTS fencing_token BIGINT NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS transition_state VARCHAR(32) NOT NULL DEFAULT 'idle',
    ADD COLUMN IF NOT EXISTS transition_op_id VARCHAR(64) NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_room_participants_fencing ON room_participants(room_id, identity, fencing_token);
