-- ==============================================================================
-- Migration: 000001_init_schema.sql
-- Phase 1 Foundation: Minimal schema for database connectivity validation,
-- tenant/user scoping readiness, and structured system event logging.
-- ==============================================================================

-- Enable cryptographic extensions for non-guessable identifiers
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- pgcrypto supplies gen_random_bytes() and HMAC-SHA256 used by later migrations.
-- Keep it in public because the security functions explicitly qualify its functions.
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;

-- Schema migration & system heartbeat metadata table
CREATE TABLE IF NOT EXISTS schema_metadata (
    id SERIAL PRIMARY KEY,
    version VARCHAR(32) NOT NULL UNIQUE,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    description TEXT NOT NULL
);

INSERT INTO schema_metadata (version, description)
VALUES ('000001_init_schema', 'Initial foundational schema for Tathastu Connect')
ON CONFLICT (version) DO NOTHING;

-- Multi-tenant / Organization scoping foundation
CREATE TABLE IF NOT EXISTS organizations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    slug VARCHAR(64) NOT NULL UNIQUE,
    name VARCHAR(255) NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'active',
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Future Collaboration Nodes (Researchers, Mentors, Projects, Topics)
-- Structure strictly prepared for tenant and ownership scoping
CREATE TABLE IF NOT EXISTS collaboration_nodes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
    node_type VARCHAR(32) NOT NULL, -- 'researcher', 'mentor', 'project', 'topic'
    display_title VARCHAR(255) NOT NULL,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_collab_nodes_org ON collaboration_nodes(organization_id);
CREATE INDEX IF NOT EXISTS idx_collab_nodes_type ON collaboration_nodes(node_type);

-- Immutable security audit log foundation
CREATE TABLE IF NOT EXISTS security_audit_events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID REFERENCES organizations(id) ON DELETE SET NULL,
    event_type VARCHAR(64) NOT NULL,
    severity VARCHAR(16) NOT NULL DEFAULT 'INFO',
    actor_id VARCHAR(128),
    ip_hash VARCHAR(64),
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_audit_created_at ON security_audit_events(created_at DESC);
