-- ==============================================================================
-- Migration: 000004_meeting_notes_and_files.sql
-- Phase 4: Persistent Shared Notes & Secure Meeting File Sharing
-- ==============================================================================

INSERT INTO schema_metadata (version, description)
VALUES ('000004_meeting_notes_and_files', 'Persistent meeting notes and secure meeting file sharing')
ON CONFLICT (version) DO NOTHING;

-- 1. Meeting Notes Table (Persistent collaborative notes with revision tracking)
CREATE TABLE IF NOT EXISTS meeting_notes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    room_id UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL DEFAULT 'Meeting Notes',
    content TEXT NOT NULL DEFAULT '',
    revision INT NOT NULL DEFAULT 1,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_by_identity VARCHAR(128) NOT NULL,
    updated_by_identity VARCHAR(128) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_meeting_notes_room_id ON meeting_notes(room_id);
CREATE INDEX IF NOT EXISTS idx_meeting_notes_revision ON meeting_notes(room_id, revision);

-- 2. Meeting Files Table (Quarantine-scanned file sharing records)
CREATE TABLE IF NOT EXISTS meeting_files (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    room_id UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    uploaded_by_identity VARCHAR(128) NOT NULL,
    uploader_name VARCHAR(100) NOT NULL,
    original_filename VARCHAR(255) NOT NULL,
    sanitized_filename VARCHAR(255) NOT NULL,
    storage_key VARCHAR(512) NOT NULL,
    content_type VARCHAR(100) NOT NULL,
    size_bytes BIGINT NOT NULL,
    scan_status VARCHAR(32) NOT NULL DEFAULT 'pending', -- 'pending', 'scanning', 'available', 'rejected', 'quarantined'
    scan_result TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_meeting_files_room_id ON meeting_files(room_id);
CREATE INDEX IF NOT EXISTS idx_meeting_files_scan_status ON meeting_files(scan_status);
