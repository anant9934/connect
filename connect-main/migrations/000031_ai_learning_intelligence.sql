-- ==============================================================================
-- Migration: 000031_ai_learning_intelligence.sql
-- Stage Phase 5: AI-Powered Learning Intelligence Architecture & Data Ledger
-- Organization-level AI governance policies, atomic budget controls,
-- immutable AI token usage ledger, and persistent AI-generated learning artifacts.
-- Rollback: tests/sql/rollback_000031.sql
-- ==============================================================================

INSERT INTO schema_metadata (version, description)
VALUES ('000031_ai_learning_intelligence', 'AI learning intelligence, provider policies, usage ledger, and generated artifacts')
ON CONFLICT (version) DO NOTHING;

-- 1. AI Organization Policies & Budget Configuration
CREATE TABLE IF NOT EXISTS ai_organization_policies (
    organization_id UUID PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
    budget_mode VARCHAR(32) NOT NULL DEFAULT 'free_only',
    monthly_budget_micro_usd BIGINT NOT NULL DEFAULT 0,
    current_spend_micro_usd BIGINT NOT NULL DEFAULT 0,
    billing_cycle_anchor TIMESTAMPTZ NOT NULL DEFAULT date_trunc('month', clock_timestamp()),
    allowed_models TEXT[] NOT NULL DEFAULT ARRAY['gemini-2.0-flash', 'gemini-1.5-flash', 'llama-3.3-70b-versatile']::TEXT[],
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT ck_ai_org_budget_mode CHECK (budget_mode IN ('free_only', 'capped', 'unlimited')),
    CONSTRAINT ck_ai_org_budget_non_negative CHECK (monthly_budget_micro_usd >= 0),
    CONSTRAINT ck_ai_org_spend_non_negative CHECK (current_spend_micro_usd >= 0)
);

CREATE INDEX IF NOT EXISTS idx_ai_org_policies_org ON ai_organization_policies(organization_id);

-- 2. AI Token Usage & Cost Ledger (Immutable Audit Log)
CREATE TABLE IF NOT EXISTS ai_usage_ledger (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    course_id UUID REFERENCES courses(id) ON DELETE SET NULL,
    class_id UUID REFERENCES classes(id) ON DELETE SET NULL,
    session_id UUID REFERENCES class_sessions(id) ON DELETE SET NULL,
    provider_name VARCHAR(64) NOT NULL,
    model_name VARCHAR(128) NOT NULL,
    feature_name VARCHAR(64) NOT NULL,
    prompt_tokens INT NOT NULL DEFAULT 0,
    completion_tokens INT NOT NULL DEFAULT 0,
    total_tokens INT NOT NULL DEFAULT 0,
    estimated_cost_micro_usd BIGINT NOT NULL DEFAULT 0,
    billed_cost_micro_usd BIGINT NOT NULL DEFAULT 0,
    latency_ms INT NOT NULL DEFAULT 0,
    status VARCHAR(32) NOT NULL DEFAULT 'success',
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT uq_ai_usage_ledger_org_id UNIQUE (organization_id, id),
    CONSTRAINT ck_ai_usage_feature CHECK (feature_name IN ('lecture_summary', 'practice_quiz', 'flashcards', 'study_plan', 'tutor_chat')),
    CONSTRAINT ck_ai_usage_status CHECK (status IN ('success', 'error', 'throttled', 'budget_exceeded'))
);

CREATE INDEX IF NOT EXISTS idx_ai_usage_ledger_org_time ON ai_usage_ledger(organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_usage_ledger_user ON ai_usage_ledger(organization_id, user_id, feature_name);
CREATE INDEX IF NOT EXISTS idx_ai_usage_ledger_course ON ai_usage_ledger(organization_id, course_id) WHERE course_id IS NOT NULL;

-- 3. AI Generated Learning Artifacts
CREATE TABLE IF NOT EXISTS ai_artifacts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    course_id UUID REFERENCES courses(id) ON DELETE CASCADE,
    class_id UUID REFERENCES classes(id) ON DELETE CASCADE,
    session_id UUID REFERENCES class_sessions(id) ON DELETE SET NULL,
    creator_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    artifact_type VARCHAR(64) NOT NULL,
    title VARCHAR(255) NOT NULL,
    content JSONB NOT NULL,
    storage_path TEXT,
    visibility VARCHAR(32) NOT NULL DEFAULT 'faculty_only',
    human_reviewed BOOLEAN NOT NULL DEFAULT false,
    reviewed_by UUID REFERENCES users(id) ON DELETE SET NULL,
    reviewed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT uq_ai_artifacts_org_id UNIQUE (organization_id, id),
    CONSTRAINT ck_ai_artifacts_type CHECK (artifact_type IN ('lecture_summary', 'practice_quiz', 'flashcard_deck', 'study_plan')),
    CONSTRAINT ck_ai_artifacts_visibility CHECK (visibility IN ('faculty_only', 'published', 'archived'))
);

CREATE INDEX IF NOT EXISTS idx_ai_artifacts_org_course ON ai_artifacts(organization_id, course_id, artifact_type);
CREATE INDEX IF NOT EXISTS idx_ai_artifacts_org_session ON ai_artifacts(organization_id, session_id) WHERE session_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ai_artifacts_org_visibility ON ai_artifacts(organization_id, visibility);

-- ==============================================================================
-- ROW LEVEL SECURITY (RLS) POLICIES
-- ==============================================================================

-- Table: ai_organization_policies
ALTER TABLE ai_organization_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_organization_policies FORCE ROW LEVEL SECURITY;

CREATE POLICY rls_tenant_ai_org_policies ON ai_organization_policies
    AS RESTRICTIVE USING (
        connect_auth.is_super_admin() OR
        organization_id = connect_auth.current_org_id()
    );

CREATE POLICY rls_ai_org_policies_select ON ai_organization_policies
    AS PERMISSIVE FOR SELECT
    USING (
        connect_auth.is_super_admin() OR (
            organization_id = connect_auth.current_org_id() AND
            connect_auth.current_role() IN ('institution_admin', 'department_coordinator', 'faculty')
        )
    );

CREATE POLICY rls_ai_org_policies_manage ON ai_organization_policies
    AS PERMISSIVE FOR ALL
    USING (
        connect_auth.is_super_admin() OR (
            organization_id = connect_auth.current_org_id() AND
            connect_auth.current_role() = 'institution_admin'
        )
    )
    WITH CHECK (
        connect_auth.is_super_admin() OR (
            organization_id = connect_auth.current_org_id() AND
            connect_auth.current_role() = 'institution_admin'
        )
    );

-- Table: ai_usage_ledger (Immutable append-only ledger for tenant users)
ALTER TABLE ai_usage_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_usage_ledger FORCE ROW LEVEL SECURITY;

CREATE POLICY rls_tenant_ai_usage_ledger ON ai_usage_ledger
    AS RESTRICTIVE USING (
        connect_auth.is_super_admin() OR
        organization_id = connect_auth.current_org_id()
    );

CREATE POLICY rls_ai_usage_ledger_select ON ai_usage_ledger
    AS PERMISSIVE FOR SELECT
    USING (
        connect_auth.is_super_admin() OR (
            organization_id = connect_auth.current_org_id() AND (
                connect_auth.current_role() IN ('institution_admin', 'department_coordinator') OR
                user_id = connect_auth.current_user_id()
            )
        )
    );

CREATE POLICY rls_ai_usage_ledger_insert ON ai_usage_ledger
    AS PERMISSIVE FOR INSERT
    WITH CHECK (
        connect_auth.is_super_admin() OR (
            organization_id = connect_auth.current_org_id() AND
            user_id = connect_auth.current_user_id()
        )
    );

-- Non-super-admins cannot update or delete immutable usage records
CREATE POLICY rls_ai_usage_ledger_immutable_update ON ai_usage_ledger
    AS PERMISSIVE FOR UPDATE
    USING (connect_auth.is_super_admin())
    WITH CHECK (connect_auth.is_super_admin());

CREATE POLICY rls_ai_usage_ledger_immutable_delete ON ai_usage_ledger
    AS PERMISSIVE FOR DELETE
    USING (connect_auth.is_super_admin());

-- Table: ai_artifacts
ALTER TABLE ai_artifacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_artifacts FORCE ROW LEVEL SECURITY;

CREATE POLICY rls_tenant_ai_artifacts ON ai_artifacts
    AS RESTRICTIVE USING (
        connect_auth.is_super_admin() OR
        organization_id = connect_auth.current_org_id()
    );

-- Students can ONLY view published artifacts; Faculty and admins can view drafts and published
CREATE POLICY rls_ai_artifacts_select ON ai_artifacts
    AS PERMISSIVE FOR SELECT
    USING (
        connect_auth.is_super_admin() OR (
            organization_id = connect_auth.current_org_id() AND (
                connect_auth.current_role() IN ('institution_admin', 'department_coordinator', 'faculty') OR
                visibility = 'published'
            )
        )
    );

-- Only Faculty and Admins can create artifacts
CREATE POLICY rls_ai_artifacts_insert ON ai_artifacts
    AS PERMISSIVE FOR INSERT
    WITH CHECK (
        connect_auth.is_super_admin() OR (
            organization_id = connect_auth.current_org_id() AND
            connect_auth.current_role() IN ('institution_admin', 'department_coordinator', 'faculty') AND
            creator_user_id = connect_auth.current_user_id()
        )
    );

-- Only Faculty and Admins can update/review artifacts
CREATE POLICY rls_ai_artifacts_update ON ai_artifacts
    AS PERMISSIVE FOR UPDATE
    USING (
        connect_auth.is_super_admin() OR (
            organization_id = connect_auth.current_org_id() AND
            connect_auth.current_role() IN ('institution_admin', 'department_coordinator', 'faculty')
        )
    )
    WITH CHECK (
        connect_auth.is_super_admin() OR (
            organization_id = connect_auth.current_org_id() AND
            connect_auth.current_role() IN ('institution_admin', 'department_coordinator', 'faculty')
        )
    );

-- Only Faculty and Admins can delete artifacts
CREATE POLICY rls_ai_artifacts_delete ON ai_artifacts
    AS PERMISSIVE FOR DELETE
    USING (
        connect_auth.is_super_admin() OR (
            organization_id = connect_auth.current_org_id() AND
            connect_auth.current_role() IN ('institution_admin', 'department_coordinator', 'faculty')
        )
    );

-- Grants on all new domain tables to connect_app and connect_worker
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE ai_organization_policies TO connect_app, connect_worker;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE ai_usage_ledger TO connect_app, connect_worker;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE ai_artifacts TO connect_app, connect_worker;
