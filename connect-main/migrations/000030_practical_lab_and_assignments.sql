-- ==============================================================================
-- Migration: 000030_practical_lab_and_assignments.sql
-- Stage Phase 4: Complete Programming & Practical Learning Platform
-- Dedicated multi-language course workspaces, interactive exercises,
-- assignments, test case management (public vs hidden), student submissions,
-- evaluation results, and student progress tracking.
-- Rollback: tests/sql/rollback_000030.sql
-- ==============================================================================

INSERT INTO schema_metadata (version, description)
VALUES ('000030_practical_lab_and_assignments', 'Practical learning platform, multi-language code labs, test cases, and assignments')
ON CONFLICT (version) DO NOTHING;

-- 1. Lab Courses Configuration Table (Tied to Tenant & Academic Course)
CREATE TABLE IF NOT EXISTS lab_courses (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL,
    course_id UUID NOT NULL,
    slug VARCHAR(64) NOT NULL,
    title VARCHAR(255) NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    category VARCHAR(64) NOT NULL DEFAULT 'computer_science',
    primary_language VARCHAR(32) NOT NULL DEFAULT 'cpp',
    allowed_languages TEXT[] NOT NULL DEFAULT ARRAY['cpp']::TEXT[],
    interactive_tools TEXT[] NOT NULL DEFAULT ARRAY['editor']::TEXT[],
    starter_code JSONB NOT NULL DEFAULT '{}'::JSONB,
    status VARCHAR(32) NOT NULL DEFAULT 'active',
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT uq_lab_courses_org_id UNIQUE (organization_id, id),
    CONSTRAINT uq_lab_courses_org_slug UNIQUE (organization_id, slug),
    CONSTRAINT fk_lab_courses_course FOREIGN KEY (organization_id, course_id)
        REFERENCES courses(organization_id, id) ON DELETE CASCADE,
    CONSTRAINT ck_lab_courses_status CHECK (status IN ('active', 'archived'))
);

CREATE INDEX IF NOT EXISTS idx_lab_courses_tenant_slug ON lab_courses(organization_id, slug);
CREATE INDEX IF NOT EXISTS idx_lab_courses_tenant_course ON lab_courses(organization_id, course_id);

-- 2. Lab Curriculum Modules (Units & Lessons)
CREATE TABLE IF NOT EXISTS lab_modules (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL,
    lab_course_id UUID NOT NULL,
    module_order INT NOT NULL DEFAULT 1,
    title VARCHAR(255) NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    learning_objectives TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    status VARCHAR(32) NOT NULL DEFAULT 'active',
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT uq_lab_modules_org_id UNIQUE (organization_id, id),
    CONSTRAINT fk_lab_modules_course FOREIGN KEY (organization_id, lab_course_id)
        REFERENCES lab_courses(organization_id, id) ON DELETE CASCADE,
    CONSTRAINT ck_lab_modules_status CHECK (status IN ('active', 'archived'))
);

CREATE INDEX IF NOT EXISTS idx_lab_modules_course_order ON lab_modules(organization_id, lab_course_id, module_order);

-- 3. Lab Exercises (Interactive Programming Lessons & Tasks)
CREATE TABLE IF NOT EXISTS lab_exercises (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL,
    lab_module_id UUID NOT NULL,
    exercise_order INT NOT NULL DEFAULT 1,
    title VARCHAR(255) NOT NULL,
    problem_statement TEXT NOT NULL,
    difficulty VARCHAR(32) NOT NULL DEFAULT 'medium',
    language VARCHAR(32) NOT NULL DEFAULT 'cpp',
    starter_code TEXT NOT NULL DEFAULT '',
    solution_template TEXT NOT NULL DEFAULT '',
    hints TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    points INT NOT NULL DEFAULT 10,
    status VARCHAR(32) NOT NULL DEFAULT 'active',
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT uq_lab_exercises_org_id UNIQUE (organization_id, id),
    CONSTRAINT fk_lab_exercises_module FOREIGN KEY (organization_id, lab_module_id)
        REFERENCES lab_modules(organization_id, id) ON DELETE CASCADE,
    CONSTRAINT ck_lab_exercises_difficulty CHECK (difficulty IN ('beginner', 'easy', 'medium', 'hard', 'advanced')),
    CONSTRAINT ck_lab_exercises_status CHECK (status IN ('active', 'archived'))
);

CREATE INDEX IF NOT EXISTS idx_lab_exercises_module_order ON lab_exercises(organization_id, lab_module_id, exercise_order);

-- 4. Lab Assignments (Faculty-Created Practical Problem Sets & Deadlines)
CREATE TABLE IF NOT EXISTS lab_assignments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL,
    lab_course_id UUID NOT NULL,
    created_by_user_id UUID NOT NULL,
    title VARCHAR(255) NOT NULL,
    description TEXT NOT NULL,
    allowed_languages TEXT[] NOT NULL DEFAULT ARRAY['cpp', 'python', 'java', 'javascript', 'sql']::TEXT[],
    starter_code JSONB NOT NULL DEFAULT '{}'::JSONB,
    due_at TIMESTAMPTZ NOT NULL,
    max_score INT NOT NULL DEFAULT 100,
    status VARCHAR(32) NOT NULL DEFAULT 'published',
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT uq_lab_assignments_org_id UNIQUE (organization_id, id),
    CONSTRAINT fk_lab_assignments_course FOREIGN KEY (organization_id, lab_course_id)
        REFERENCES lab_courses(organization_id, id) ON DELETE CASCADE,
    CONSTRAINT fk_lab_assignments_author FOREIGN KEY (created_by_user_id)
        REFERENCES users(id) ON DELETE RESTRICT,
    CONSTRAINT ck_lab_assignments_status CHECK (status IN ('draft', 'published', 'archived'))
);

CREATE INDEX IF NOT EXISTS idx_lab_assignments_course_due ON lab_assignments(organization_id, lab_course_id, due_at);

-- 5. Lab Test Cases (Public vs Hidden Test Suite)
CREATE TABLE IF NOT EXISTS lab_test_cases (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL,
    assignment_id UUID,
    exercise_id UUID,
    input TEXT NOT NULL DEFAULT '',
    expected_output TEXT NOT NULL DEFAULT '',
    is_hidden BOOLEAN NOT NULL DEFAULT false,
    weight INT NOT NULL DEFAULT 1,
    time_limit_ms INT NOT NULL DEFAULT 2000,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT uq_lab_test_cases_org_id UNIQUE (organization_id, id),
    CONSTRAINT fk_lab_test_cases_assignment FOREIGN KEY (organization_id, assignment_id)
        REFERENCES lab_assignments(organization_id, id) ON DELETE CASCADE,
    CONSTRAINT fk_lab_test_cases_exercise FOREIGN KEY (organization_id, exercise_id)
        REFERENCES lab_exercises(organization_id, id) ON DELETE CASCADE,
    CONSTRAINT ck_lab_test_cases_target CHECK (
        (assignment_id IS NOT NULL AND exercise_id IS NULL) OR
        (assignment_id IS NULL AND exercise_id IS NOT NULL)
    )
);

CREATE INDEX IF NOT EXISTS idx_lab_test_cases_assignment ON lab_test_cases(organization_id, assignment_id, is_hidden);
CREATE INDEX IF NOT EXISTS idx_lab_test_cases_exercise ON lab_test_cases(organization_id, exercise_id, is_hidden);

-- 6. Lab Submissions (Student Solution Attempts & Auto-Graded Results)
CREATE TABLE IF NOT EXISTS lab_submissions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL,
    assignment_id UUID,
    exercise_id UUID,
    student_user_id UUID NOT NULL,
    language VARCHAR(32) NOT NULL,
    source_code TEXT NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'pending',
    score INT NOT NULL DEFAULT 0,
    passed_count INT NOT NULL DEFAULT 0,
    total_count INT NOT NULL DEFAULT 0,
    execution_duration_ms INT NOT NULL DEFAULT 0,
    stdout TEXT NOT NULL DEFAULT '',
    stderr TEXT NOT NULL DEFAULT '',
    test_results JSONB NOT NULL DEFAULT '[]'::JSONB,
    faculty_feedback TEXT NOT NULL DEFAULT '',
    graded_by_user_id UUID,
    graded_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT uq_lab_submissions_org_id UNIQUE (organization_id, id),
    CONSTRAINT fk_lab_submissions_assignment FOREIGN KEY (organization_id, assignment_id)
        REFERENCES lab_assignments(organization_id, id) ON DELETE CASCADE,
    CONSTRAINT fk_lab_submissions_exercise FOREIGN KEY (organization_id, exercise_id)
        REFERENCES lab_exercises(organization_id, id) ON DELETE CASCADE,
    CONSTRAINT fk_lab_submissions_student FOREIGN KEY (student_user_id)
        REFERENCES users(id) ON DELETE RESTRICT,
    CONSTRAINT fk_lab_submissions_grader FOREIGN KEY (graded_by_user_id)
        REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT ck_lab_submissions_target CHECK (
        (assignment_id IS NOT NULL AND exercise_id IS NULL) OR
        (assignment_id IS NULL AND exercise_id IS NOT NULL)
    ),
    CONSTRAINT ck_lab_submissions_status CHECK (status IN ('pending', 'running', 'passed', 'failed', 'error', 'graded'))
);

CREATE INDEX IF NOT EXISTS idx_lab_submissions_assignment_student ON lab_submissions(organization_id, assignment_id, student_user_id);
CREATE INDEX IF NOT EXISTS idx_lab_submissions_exercise_student ON lab_submissions(organization_id, exercise_id, student_user_id);
CREATE INDEX IF NOT EXISTS idx_lab_submissions_student_created ON lab_submissions(organization_id, student_user_id, created_at DESC);

-- 7. Lab Student Progress (Persistent Stats & Streaks)
CREATE TABLE IF NOT EXISTS lab_student_progress (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL,
    lab_course_id UUID NOT NULL,
    student_user_id UUID NOT NULL,
    exercises_completed INT NOT NULL DEFAULT 0,
    assignments_submitted INT NOT NULL DEFAULT 0,
    total_points INT NOT NULL DEFAULT 0,
    current_streak_days INT NOT NULL DEFAULT 0,
    last_activity_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT uq_lab_student_progress_key UNIQUE (organization_id, lab_course_id, student_user_id),
    CONSTRAINT fk_lab_student_progress_course FOREIGN KEY (organization_id, lab_course_id)
        REFERENCES lab_courses(organization_id, id) ON DELETE CASCADE,
    CONSTRAINT fk_lab_student_progress_student FOREIGN KEY (student_user_id)
        REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_lab_progress_tenant_student ON lab_student_progress(organization_id, student_user_id);

-- ==============================================================================
-- ROW LEVEL SECURITY (RLS) FORCED DEFENSE
-- ==============================================================================

ALTER TABLE lab_courses ENABLE ROW LEVEL SECURITY;
ALTER TABLE lab_courses FORCE ROW LEVEL SECURITY;

ALTER TABLE lab_modules ENABLE ROW LEVEL SECURITY;
ALTER TABLE lab_modules FORCE ROW LEVEL SECURITY;

ALTER TABLE lab_exercises ENABLE ROW LEVEL SECURITY;
ALTER TABLE lab_exercises FORCE ROW LEVEL SECURITY;

ALTER TABLE lab_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE lab_assignments FORCE ROW LEVEL SECURITY;

ALTER TABLE lab_test_cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE lab_test_cases FORCE ROW LEVEL SECURITY;

ALTER TABLE lab_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE lab_submissions FORCE ROW LEVEL SECURITY;

ALTER TABLE lab_student_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE lab_student_progress FORCE ROW LEVEL SECURITY;

-- Security Definer: Determine if caller is faculty or coordinator for a lab course
CREATE OR REPLACE FUNCTION connect_auth.can_manage_lab_course(p_lab_course_id UUID)
RETURNS BOOLEAN
SECURITY DEFINER SET search_path = pg_catalog, public, connect_auth
LANGUAGE plpgsql STABLE AS $$
DECLARE
    v_org UUID;
    v_course UUID;
    v_role VARCHAR := connect_auth.current_role();
    v_user UUID := connect_auth.current_user_id();
BEGIN
    IF connect_auth.is_super_admin() THEN
        RETURN true;
    END IF;
    IF v_user IS NULL OR v_role IS NULL THEN
        RETURN false;
    END IF;
    SELECT lc.organization_id, lc.course_id INTO v_org, v_course
    FROM public.lab_courses lc WHERE lc.id = p_lab_course_id;
    IF v_org IS NULL OR v_org <> connect_auth.current_org_id() THEN
        RETURN false;
    END IF;
    IF v_role IN ('institution_admin', 'department_coordinator') THEN
        RETURN true;
    END IF;
    IF v_role = 'faculty' THEN
        RETURN EXISTS (
            SELECT 1 FROM public.faculty_allocations fa
            WHERE fa.course_id = v_course
              AND fa.faculty_user_id = v_user
              AND fa.status = 'active'
        );
    END IF;
    RETURN false;
END;
$$;

REVOKE ALL ON FUNCTION connect_auth.can_manage_lab_course(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION connect_auth.can_manage_lab_course(UUID) TO connect_app, connect_worker;

-- 1. Policies for lab_courses
CREATE POLICY rls_tenant_lab_courses ON lab_courses
    AS RESTRICTIVE USING (
        connect_auth.is_super_admin() OR
        organization_id = connect_auth.current_org_id()
    );

CREATE POLICY rls_lab_courses_select ON lab_courses
    AS PERMISSIVE FOR SELECT
    USING (
        connect_auth.is_super_admin() OR
        organization_id = connect_auth.current_org_id()
    );

CREATE POLICY rls_lab_courses_manage ON lab_courses
    AS PERMISSIVE FOR ALL
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

-- 2. Policies for lab_modules
CREATE POLICY rls_tenant_lab_modules ON lab_modules
    AS RESTRICTIVE USING (
        connect_auth.is_super_admin() OR
        organization_id = connect_auth.current_org_id()
    );

CREATE POLICY rls_lab_modules_select ON lab_modules
    AS PERMISSIVE FOR SELECT
    USING (
        connect_auth.is_super_admin() OR
        organization_id = connect_auth.current_org_id()
    );

CREATE POLICY rls_lab_modules_manage ON lab_modules
    AS PERMISSIVE FOR ALL
    USING (
        connect_auth.is_super_admin() OR (
            organization_id = connect_auth.current_org_id() AND
            connect_auth.can_manage_lab_course(lab_course_id)
        )
    )
    WITH CHECK (
        connect_auth.is_super_admin() OR (
            organization_id = connect_auth.current_org_id() AND
            connect_auth.can_manage_lab_course(lab_course_id)
        )
    );

-- 3. Policies for lab_exercises
CREATE POLICY rls_tenant_lab_exercises ON lab_exercises
    AS RESTRICTIVE USING (
        connect_auth.is_super_admin() OR
        organization_id = connect_auth.current_org_id()
    );

CREATE POLICY rls_lab_exercises_select ON lab_exercises
    AS PERMISSIVE FOR SELECT
    USING (
        connect_auth.is_super_admin() OR
        organization_id = connect_auth.current_org_id()
    );

CREATE POLICY rls_lab_exercises_manage ON lab_exercises
    AS PERMISSIVE FOR ALL
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

-- 4. Policies for lab_assignments
CREATE POLICY rls_tenant_lab_assignments ON lab_assignments
    AS RESTRICTIVE USING (
        connect_auth.is_super_admin() OR
        organization_id = connect_auth.current_org_id()
    );

CREATE POLICY rls_lab_assignments_select ON lab_assignments
    AS PERMISSIVE FOR SELECT
    USING (
        connect_auth.is_super_admin() OR (
            organization_id = connect_auth.current_org_id() AND (
                status = 'published' OR
                connect_auth.can_manage_lab_course(lab_course_id)
            )
        )
    );

CREATE POLICY rls_lab_assignments_manage ON lab_assignments
    AS PERMISSIVE FOR ALL
    USING (
        connect_auth.is_super_admin() OR (
            organization_id = connect_auth.current_org_id() AND
            connect_auth.can_manage_lab_course(lab_course_id)
        )
    )
    WITH CHECK (
        connect_auth.is_super_admin() OR (
            organization_id = connect_auth.current_org_id() AND
            connect_auth.can_manage_lab_course(lab_course_id)
        )
    );

-- 5. Policies for lab_test_cases (Crucial Defense: Students NEVER see hidden test cases)
CREATE POLICY rls_tenant_lab_test_cases ON lab_test_cases
    AS RESTRICTIVE USING (
        connect_auth.is_super_admin() OR
        organization_id = connect_auth.current_org_id()
    );

CREATE POLICY rls_lab_test_cases_select ON lab_test_cases
    AS PERMISSIVE FOR SELECT
    USING (
        connect_auth.is_super_admin() OR (
            organization_id = connect_auth.current_org_id() AND (
                -- Non-hidden test cases are visible to everyone in the tenant
                is_hidden = false OR
                -- Faculty / admins can inspect both public and hidden test cases
                connect_auth.current_role() IN ('institution_admin', 'department_coordinator', 'faculty')
            )
        )
    );

CREATE POLICY rls_lab_test_cases_manage ON lab_test_cases
    AS PERMISSIVE FOR ALL
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

-- 6. Policies for lab_submissions
CREATE POLICY rls_tenant_lab_submissions ON lab_submissions
    AS RESTRICTIVE USING (
        connect_auth.is_super_admin() OR
        organization_id = connect_auth.current_org_id()
    );

CREATE POLICY rls_lab_submissions_select ON lab_submissions
    AS PERMISSIVE FOR SELECT
    USING (
        connect_auth.is_super_admin() OR (
            organization_id = connect_auth.current_org_id() AND (
                student_user_id = connect_auth.current_user_id() OR
                connect_auth.current_role() IN ('institution_admin', 'department_coordinator', 'faculty')
            )
        )
    );

CREATE POLICY rls_lab_submissions_insert ON lab_submissions
    AS PERMISSIVE FOR INSERT
    WITH CHECK (
        connect_auth.is_super_admin() OR (
            organization_id = connect_auth.current_org_id() AND
            student_user_id = connect_auth.current_user_id()
        )
    );

CREATE POLICY rls_lab_submissions_update ON lab_submissions
    AS PERMISSIVE FOR UPDATE
    USING (
        connect_auth.is_super_admin() OR (
            organization_id = connect_auth.current_org_id() AND (
                student_user_id = connect_auth.current_user_id() OR
                connect_auth.current_role() IN ('institution_admin', 'department_coordinator', 'faculty')
            )
        )
    )
    WITH CHECK (
        connect_auth.is_super_admin() OR (
            organization_id = connect_auth.current_org_id() AND (
                student_user_id = connect_auth.current_user_id() OR
                connect_auth.current_role() IN ('institution_admin', 'department_coordinator', 'faculty')
            )
        )
    );

-- 7. Policies for lab_student_progress
CREATE POLICY rls_tenant_lab_progress ON lab_student_progress
    AS RESTRICTIVE USING (
        connect_auth.is_super_admin() OR
        organization_id = connect_auth.current_org_id()
    );

CREATE POLICY rls_lab_progress_select ON lab_student_progress
    AS PERMISSIVE FOR SELECT
    USING (
        connect_auth.is_super_admin() OR (
            organization_id = connect_auth.current_org_id() AND (
                student_user_id = connect_auth.current_user_id() OR
                connect_auth.current_role() IN ('institution_admin', 'department_coordinator', 'faculty')
            )
        )
    );

CREATE POLICY rls_lab_progress_manage ON lab_student_progress
    AS PERMISSIVE FOR ALL
    USING (
        connect_auth.is_super_admin() OR (
            organization_id = connect_auth.current_org_id() AND (
                student_user_id = connect_auth.current_user_id() OR
                connect_auth.current_role() IN ('institution_admin', 'department_coordinator', 'faculty')
            )
        )
    )
    WITH CHECK (
        connect_auth.is_super_admin() OR (
            organization_id = connect_auth.current_org_id() AND (
                student_user_id = connect_auth.current_user_id() OR
                connect_auth.current_role() IN ('institution_admin', 'department_coordinator', 'faculty')
            )
        )
    );

-- Grants on all new domain tables to connect_app and connect_worker
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE lab_courses TO connect_app, connect_worker;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE lab_modules TO connect_app, connect_worker;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE lab_exercises TO connect_app, connect_worker;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE lab_assignments TO connect_app, connect_worker;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE lab_test_cases TO connect_app, connect_worker;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE lab_submissions TO connect_app, connect_worker;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE lab_student_progress TO connect_app, connect_worker;
