-- ==============================================================================
-- Migration: 000006_participant_distributed_locks.sql
-- Stage B: PostgreSQL-Backed Distributed Leases for Cross-Instance Serialization
-- ==============================================================================

-- Track schema version
INSERT INTO schema_metadata (version, description)
VALUES ('000006_participant_distributed_locks', 'Distributed participant lease table for multi-instance mutation serialization')
ON CONFLICT (version) DO NOTHING;

-- Participant Locks Table
CREATE TABLE IF NOT EXISTS participant_locks (
    lock_key VARCHAR(128) PRIMARY KEY,
    owner_id VARCHAR(64) NOT NULL,
    acquired_at TIMESTAMPTZ NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_participant_locks_expires_at ON participant_locks(expires_at);
