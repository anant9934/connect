-- ==============================================================================
-- Migration: 000003_waiting_room_and_history.sql
-- Phase 3: Waiting Room Admissions, Participant Moderation & Meeting History
-- ==============================================================================

INSERT INTO schema_metadata (version, description)
VALUES ('000003_waiting_room_and_history', 'Waiting room admissions, participant moderation and meeting history tracking')
ON CONFLICT (version) DO NOTHING;

-- 1. Extend Rooms table with waiting room toggle
ALTER TABLE rooms
ADD COLUMN IF NOT EXISTS waiting_room_enabled BOOLEAN NOT NULL DEFAULT false;

-- 2. Room Admissions Table (Server-managed admission queue for secure gatekeeping)
CREATE TABLE IF NOT EXISTS room_admissions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    room_id UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    identity VARCHAR(128) NOT NULL,
    display_name VARCHAR(100) NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'pending', -- 'pending', 'admitted', 'denied', 'expired'
    requested_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    decided_at TIMESTAMPTZ,
    decided_by UUID REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_room_admissions_room_id ON room_admissions(room_id);
CREATE INDEX IF NOT EXISTS idx_room_admissions_identity ON room_admissions(identity);
CREATE INDEX IF NOT EXISTS idx_room_admissions_status ON room_admissions(status);

-- 3. Room Participant Removal / Blacklist flag for eviction enforcement
ALTER TABLE room_participants
ADD COLUMN IF NOT EXISTS is_removed BOOLEAN NOT NULL DEFAULT false;
