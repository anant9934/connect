-- ==============================================================================
-- Migration: 000044_schools_and_programs.sql
-- Completes the academic hierarchy: University (organization) -> School -> Department ->
-- Degree program -> Course -> Batch (section). Schools and programs are optional links, so
-- existing departments and courses keep working. Composite keys keep every link inside one
-- organization, and row level security matches departments.
-- Rollback: tests/sql/rollback_000044.sql
-- ==============================================================================

INSERT INTO schema_metadata (version, description)
VALUES ('000044_schools_and_programs', 'Schools and degree programs in the academic hierarchy')
ON CONFLICT (version) DO NOTHING;

CREATE TABLE IF NOT EXISTS schools (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
    code VARCHAR(32) NOT NULL,
    name VARCHAR(255) NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'active',
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT uq_schools_tenant_id UNIQUE (organization_id, id),
    CONSTRAINT uq_schools_tenant_code UNIQUE (organization_id, code),
    CONSTRAINT ck_schools_status CHECK (status IN ('active', 'archived'))
);

ALTER TABLE departments ADD COLUMN IF NOT EXISTS school_id UUID;
ALTER TABLE departments ADD CONSTRAINT fk_departments_school FOREIGN KEY (organization_id, school_id)
    REFERENCES schools(organization_id, id) ON DELETE RESTRICT;

CREATE TABLE IF NOT EXISTS degree_programs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
    department_id UUID NOT NULL,
    code VARCHAR(32) NOT NULL,
    name VARCHAR(255) NOT NULL,
    level VARCHAR(32) NOT NULL DEFAULT 'undergraduate',
    duration_years SMALLINT NOT NULL DEFAULT 4,
    status VARCHAR(32) NOT NULL DEFAULT 'active',
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT uq_degree_programs_tenant_id UNIQUE (organization_id, id),
    CONSTRAINT uq_degree_programs_tenant_code UNIQUE (organization_id, code),
    CONSTRAINT fk_degree_programs_department FOREIGN KEY (organization_id, department_id)
        REFERENCES departments(organization_id, id) ON DELETE RESTRICT,
    CONSTRAINT ck_degree_programs_level CHECK (level IN ('certificate', 'diploma', 'undergraduate', 'postgraduate', 'doctoral')),
    CONSTRAINT ck_degree_programs_duration CHECK (duration_years BETWEEN 1 AND 7),
    CONSTRAINT ck_degree_programs_status CHECK (status IN ('active', 'archived'))
);

ALTER TABLE courses ADD COLUMN IF NOT EXISTS degree_program_id UUID;
ALTER TABLE courses ADD CONSTRAINT fk_courses_degree_program FOREIGN KEY (organization_id, degree_program_id)
    REFERENCES degree_programs(organization_id, id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS idx_departments_school ON departments(organization_id, school_id);
CREATE INDEX IF NOT EXISTS idx_degree_programs_department ON degree_programs(organization_id, department_id);
CREATE INDEX IF NOT EXISTS idx_courses_program ON courses(organization_id, degree_program_id);

ALTER TABLE schools ENABLE ROW LEVEL SECURITY;
ALTER TABLE schools FORCE ROW LEVEL SECURITY;
ALTER TABLE degree_programs ENABLE ROW LEVEL SECURITY;
ALTER TABLE degree_programs FORCE ROW LEVEL SECURITY;

CREATE POLICY rls_tenant_schools ON schools AS RESTRICTIVE
    USING (connect_auth.is_super_admin() OR organization_id = connect_auth.current_org_id());
CREATE POLICY rls_schools_select ON schools FOR SELECT USING (organization_id = connect_auth.current_org_id() OR connect_auth.is_super_admin());
CREATE POLICY rls_schools_insert ON schools FOR INSERT WITH CHECK (connect_auth.is_super_admin()
    OR (organization_id = connect_auth.current_org_id() AND connect_auth.current_role() = 'institution_admin'));
CREATE POLICY rls_schools_update ON schools FOR UPDATE
    USING (connect_auth.is_super_admin() OR (organization_id = connect_auth.current_org_id() AND connect_auth.current_role() = 'institution_admin'))
    WITH CHECK (connect_auth.is_super_admin() OR (organization_id = connect_auth.current_org_id() AND connect_auth.current_role() = 'institution_admin'));

CREATE POLICY rls_tenant_degree_programs ON degree_programs AS RESTRICTIVE
    USING (connect_auth.is_super_admin() OR organization_id = connect_auth.current_org_id());
CREATE POLICY rls_degree_programs_select ON degree_programs FOR SELECT USING (organization_id = connect_auth.current_org_id() OR connect_auth.is_super_admin());
CREATE POLICY rls_degree_programs_insert ON degree_programs FOR INSERT WITH CHECK (connect_auth.is_super_admin()
    OR (organization_id = connect_auth.current_org_id() AND connect_auth.current_role() = 'institution_admin'));
CREATE POLICY rls_degree_programs_update ON degree_programs FOR UPDATE
    USING (connect_auth.is_super_admin() OR (organization_id = connect_auth.current_org_id() AND connect_auth.current_role() = 'institution_admin'))
    WITH CHECK (connect_auth.is_super_admin() OR (organization_id = connect_auth.current_org_id() AND connect_auth.current_role() = 'institution_admin'));

GRANT SELECT, INSERT, UPDATE ON schools, degree_programs TO connect_app;
GRANT SELECT ON schools, degree_programs TO connect_worker;
