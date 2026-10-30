-- ==============================================================================
-- Migration: 000005_user_profile_and_providers.sql
-- Phase 5: User Profile Management, Bundled Avatar Selection,
-- Google OAuth Subject Mapping, Multi-Provider Identity, and Preferences.
-- ==============================================================================

-- Widen schema_metadata version column if needed
ALTER TABLE schema_metadata ALTER COLUMN version TYPE VARCHAR(64);

-- Track schema version
INSERT INTO schema_metadata (version, description)
VALUES ('000005_user_profile_and_providers', 'User profile attributes, avatar references, Google OAuth linking, and preferences')
ON CONFLICT (version) DO NOTHING;

-- Add avatar columns if not exists
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_id VARCHAR(64) DEFAULT '';
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url TEXT DEFAULT '';

-- Add multi-provider and Google OAuth mapping columns
ALTER TABLE users ADD COLUMN IF NOT EXISTS google_id VARCHAR(255);
ALTER TABLE users ADD COLUMN IF NOT EXISTS auth_provider VARCHAR(32) NOT NULL DEFAULT 'password';
ALTER TABLE users ADD COLUMN IF NOT EXISTS preferences JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified BOOLEAN NOT NULL DEFAULT false;

-- Allow password_hash to be nullable for OAuth-only users
ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;

-- Indexes for fast identity resolution and provider lookup
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_google_id ON users(google_id) WHERE google_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_users_auth_provider ON users(auth_provider);
