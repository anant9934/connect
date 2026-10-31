-- ==============================================================================
-- Migration: 000007_tenancy_and_academic_core.sql
-- Stage C0.4: Multi-Tenancy Core, Decoupled Identity, Academic Structures,
-- Temporal Enrollment, Faculty Lifecycles, and Immutable Event Ledgers.
-- ==============================================================================

-- Widen schema_metadata version column if needed
ALTER TABLE schema_metadata ALTER COLUMN version TYPE VARCHAR(64);

INSERT INTO schema_metadata (version, description)
VALUES ('000007_tenancy_and_academic_core', 'Multi-tenancy, academic relational core, temporal enrollment, and immutable attendance ledger')
ON CONFLICT (version) DO NOTHING;

-- 1. RFC 9562 Compliant UUIDv7 Generator Function
CREATE OR REPLACE FUNCTION uuid_generate_v7()
RETURNS UUID AS $$
DECLARE
    unix_time_ms BIGINT;
    rand_bytes BYTEA;
    hex_time VARCHAR(12);
    uuid_bytes BYTEA;
BEGIN
    unix_time_ms := FLOOR(EXTRACT(EPOCH FROM clock_timestamp()) * 1000);
    hex_time := LPAD(TO_HEX(unix_time_ms), 12, '0');
    rand_bytes := gen_random_bytes(10);

    uuid_bytes := DECODE(hex_time, 'hex') || rand_bytes;

    -- Set Version 7 (bits 48-51: 0111)
    uuid_bytes := SET_BYTE(uuid_bytes, 6, (GET_BYTE(uuid_bytes, 6) & 15) | 112);
    -- Set Variant to RFC 4122 / 9562 (bits 64-65: 10)
    uuid_bytes := SET_BYTE(uuid_bytes, 8, (GET_BYTE(uuid_bytes, 8) & 63) | 128);

    RETURN ENCODE(uuid_bytes, 'hex')::UUID;
END;
$$ LANGUAGE plpgsql VOLATILE;

-- 2. Platform Administrators (Authoritative Super-Admin Registry)
CREATE TABLE IF NOT EXISTS platform_administrators (
    user_id UUID PRIMARY KEY,
    role VARCHAR(32) NOT NULL DEFAULT 'platform_super_admin',
    status VARCHAR(32) NOT NULL DEFAULT 'active',
    granted_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    granted_by UUID,
    CONSTRAINT fk_platform_admins_user FOREIGN KEY (user_id)
        REFERENCES users(id) ON DELETE RESTRICT,
    CONSTRAINT fk_platform_admins_grantor FOREIGN KEY (granted_by)
        REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT ck_platform_admins_role CHECK (role IN ('platform_super_admin', 'platform_support_operator')),
    CONSTRAINT ck_platform_admins_status CHECK (status IN ('active', 'suspended', 'revoked'))
);

-- 3. Organization Memberships (M:N User to Tenant Association)
CREATE TABLE IF NOT EXISTS organization_memberships (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL,
    user_id UUID NOT NULL,
    role VARCHAR(32) NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'active',
    member_identifier VARCHAR(64),
    joined_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    revoked_at TIMESTAMPTZ,
    revoked_by UUID,
    CONSTRAINT uq_org_memberships_tenant_user UNIQUE (organization_id, user_id),
    CONSTRAINT uq_org_memberships_tenant_identifier UNIQUE (organization_id, member_identifier),
    CONSTRAINT fk_org_memberships_org FOREIGN KEY (organization_id)
        REFERENCES organizations(id) ON DELETE RESTRICT,
    CONSTRAINT fk_org_memberships_user FOREIGN KEY (user_id)
        REFERENCES users(id) ON DELETE RESTRICT,
    CONSTRAINT fk_org_memberships_revoker FOREIGN KEY (revoked_by)
        REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT ck_org_memberships_role CHECK (role IN ('institution_admin', 'institution_auditor', 'institution_member', 'department_coordinator', 'faculty', 'student')),
    CONSTRAINT ck_org_memberships_status CHECK (status IN ('active', 'suspended', 'revoked'))
);

CREATE INDEX IF NOT EXISTS idx_org_memberships_user ON organization_memberships(user_id);
CREATE INDEX IF NOT EXISTS idx_org_memberships_role ON organization_memberships(organization_id, role, status);

-- 4. Table-Specific Concurrency-Safe Membership Validation Functions (FOR SHARE Locking)
CREATE OR REPLACE FUNCTION fn_assert_active_faculty_allocation_membership()
RETURNS TRIGGER AS $$
DECLARE
    v_status VARCHAR(32);
BEGIN
    SELECT status INTO v_status
    FROM organization_memberships
    WHERE organization_id = NEW.organization_id AND user_id = NEW.faculty_user_id
    FOR SHARE;

    IF v_status IS NULL THEN
        RAISE EXCEPTION 'Foreign Key Violation: Faculty % is not a member of Organization %',
            NEW.faculty_user_id, NEW.organization_id USING ERRCODE = 'foreign_key_violation';
    END IF;

    IF v_status != 'active' THEN
        RAISE EXCEPTION 'Integrity Error: Cannot allocate Faculty % with non-active membership status: %',
            NEW.faculty_user_id, v_status USING ERRCODE = 'check_violation';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION fn_assert_active_course_enrollment_membership()
RETURNS TRIGGER AS $$
DECLARE
    v_status VARCHAR(32);
BEGIN
    SELECT status INTO v_status
    FROM organization_memberships
    WHERE organization_id = NEW.organization_id AND user_id = NEW.student_user_id
    FOR SHARE;

    IF v_status IS NULL THEN
        RAISE EXCEPTION 'Foreign Key Violation: Student % is not a member of Organization %',
            NEW.student_user_id, NEW.organization_id USING ERRCODE = 'foreign_key_violation';
    END IF;

    IF v_status != 'active' THEN
        RAISE EXCEPTION 'Integrity Error: Cannot enroll Student % with non-active membership status: %',
            NEW.student_user_id, v_status USING ERRCODE = 'check_violation';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 5. Departments (Tenant Partitioning)
CREATE TABLE IF NOT EXISTS departments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL,
    code VARCHAR(32) NOT NULL,
    name VARCHAR(255) NOT NULL,
    coordinator_user_id UUID,
    status VARCHAR(32) NOT NULL DEFAULT 'active',
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT uq_departments_tenant_id UNIQUE (organization_id, id),
    CONSTRAINT uq_departments_tenant_code UNIQUE (organization_id, code),
    CONSTRAINT fk_departments_org FOREIGN KEY (organization_id)
        REFERENCES organizations(id) ON DELETE RESTRICT,
    CONSTRAINT fk_departments_coordinator FOREIGN KEY (organization_id, coordinator_user_id)
        REFERENCES organization_memberships(organization_id, user_id) ON DELETE RESTRICT,
    CONSTRAINT ck_departments_status CHECK (status IN ('active', 'archived'))
);

CREATE INDEX IF NOT EXISTS idx_departments_org ON departments(organization_id);

-- 6. Courses (Academic Curriculum Offerings)
CREATE TABLE IF NOT EXISTS courses (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL,
    department_id UUID NOT NULL,
    code VARCHAR(32) NOT NULL,
    title VARCHAR(255) NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    credits INT NOT NULL DEFAULT 3,
    status VARCHAR(32) NOT NULL DEFAULT 'active',
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT uq_courses_tenant_id UNIQUE (organization_id, id),
    CONSTRAINT uq_courses_tenant_code UNIQUE (organization_id, code),
    CONSTRAINT fk_courses_dept FOREIGN KEY (organization_id, department_id)
        REFERENCES departments(organization_id, id) ON DELETE RESTRICT,
    CONSTRAINT ck_courses_status CHECK (status IN ('active', 'archived'))
);

CREATE INDEX IF NOT EXISTS idx_courses_org_dept ON courses(organization_id, department_id);

-- 7. Course Batches (Section / Cohort Scopes)
CREATE TABLE IF NOT EXISTS course_batches (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL,
    course_id UUID NOT NULL,
    name VARCHAR(64) NOT NULL,
    academic_term VARCHAR(64) NOT NULL,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'active',
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT uq_course_batches_tenant_id UNIQUE (organization_id, id),
    CONSTRAINT uq_course_batches_tenant_course_id UNIQUE (organization_id, course_id, id),
    CONSTRAINT uq_course_batches_name UNIQUE (organization_id, course_id, name),
    CONSTRAINT fk_course_batches_course FOREIGN KEY (organization_id, course_id)
        REFERENCES courses(organization_id, id) ON DELETE RESTRICT,
    CONSTRAINT ck_course_batches_dates CHECK (end_date >= start_date),
    CONSTRAINT ck_course_batches_status CHECK (status IN ('active', 'archived'))
);

CREATE INDEX IF NOT EXISTS idx_course_batches_course ON course_batches(organization_id, course_id);

-- 8. Faculty Allocations with Full Lifecycle & Temporal Validity
CREATE TABLE IF NOT EXISTS faculty_allocations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL,
    course_id UUID NOT NULL,
    faculty_user_id UUID NOT NULL,
    role VARCHAR(32) NOT NULL DEFAULT 'primary_instructor',
    status VARCHAR(32) NOT NULL DEFAULT 'active',
    effective_from TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    effective_to TIMESTAMPTZ,
    revoked_at TIMESTAMPTZ,
    revoked_by UUID,
    revocation_reason TEXT,
    valid_during TSTZRANGE GENERATED ALWAYS AS (
        tstzrange(effective_from, COALESCE(effective_to, 'infinity'::timestamptz), '[)')
    ) STORED,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT uq_faculty_allocations_tenant_id UNIQUE (organization_id, id),
    CONSTRAINT uq_faculty_allocations_tenant_course_id UNIQUE (organization_id, course_id, id),
    CONSTRAINT uq_faculty_allocations_assignment UNIQUE (organization_id, course_id, faculty_user_id),
    CONSTRAINT fk_faculty_allocations_course FOREIGN KEY (organization_id, course_id)
        REFERENCES courses(organization_id, id) ON DELETE RESTRICT,
    CONSTRAINT fk_faculty_allocations_membership FOREIGN KEY (organization_id, faculty_user_id)
        REFERENCES organization_memberships(organization_id, user_id) ON DELETE RESTRICT,
    CONSTRAINT fk_faculty_allocations_revoker FOREIGN KEY (revoked_by)
        REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT ck_faculty_allocations_role CHECK (role IN ('primary_instructor', 'teaching_assistant')),
    CONSTRAINT ck_faculty_allocations_status CHECK (status IN ('active', 'ended', 'revoked'))
);

CREATE INDEX IF NOT EXISTS idx_faculty_allocations_faculty ON faculty_allocations(organization_id, faculty_user_id);

CREATE TRIGGER tr_assert_active_faculty
    BEFORE INSERT OR UPDATE OF organization_id, faculty_user_id ON faculty_allocations
    FOR EACH ROW EXECUTE FUNCTION fn_assert_active_faculty_allocation_membership();

-- 9. Course Enrollments with Temporal Status & Attendance Window
CREATE TABLE IF NOT EXISTS course_enrollments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL,
    batch_id UUID NOT NULL,
    student_user_id UUID NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'enrolled',
    enrolled_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    dropped_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    valid_during TSTZRANGE GENERATED ALWAYS AS (
        tstzrange(enrolled_at, COALESCE(dropped_at, completed_at, 'infinity'::timestamptz), '[)')
    ) STORED,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT uq_course_enrollments_tenant_id UNIQUE (organization_id, id),
    CONSTRAINT uq_course_enrollments_tenant_batch_student UNIQUE (organization_id, batch_id, student_user_id),
    CONSTRAINT fk_course_enrollments_batch FOREIGN KEY (organization_id, batch_id)
        REFERENCES course_batches(organization_id, id) ON DELETE RESTRICT,
    CONSTRAINT fk_course_enrollments_membership FOREIGN KEY (organization_id, student_user_id)
        REFERENCES organization_memberships(organization_id, user_id) ON DELETE RESTRICT,
    CONSTRAINT ck_course_enrollments_status CHECK (status IN ('enrolled', 'dropped', 'completed'))
);

CREATE INDEX IF NOT EXISTS idx_course_enrollments_student ON course_enrollments(student_user_id);
CREATE INDEX IF NOT EXISTS idx_course_enrollments_batch ON course_enrollments(organization_id, batch_id);

CREATE TRIGGER tr_assert_active_student
    BEFORE INSERT OR UPDATE OF organization_id, student_user_id ON course_enrollments
    FOR EACH ROW EXECUTE FUNCTION fn_assert_active_course_enrollment_membership();

-- 10. Class Sessions (Authoritative Academic Lecture Schedule)
CREATE TABLE IF NOT EXISTS class_sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL,
    course_id UUID NOT NULL,
    batch_id UUID NOT NULL,
    faculty_allocation_id UUID NOT NULL,
    title VARCHAR(255) NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    scheduled_start TIMESTAMPTZ NOT NULL,
    scheduled_end TIMESTAMPTZ NOT NULL,
    actual_start TIMESTAMPTZ,
    actual_end TIMESTAMPTZ,
    status VARCHAR(32) NOT NULL DEFAULT 'scheduled',
    attendance_finalized BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT uq_class_sessions_tenant_id UNIQUE (organization_id, id),
    CONSTRAINT uq_class_sessions_tenant_batch_id UNIQUE (organization_id, batch_id, id),
    CONSTRAINT fk_class_sessions_batch FOREIGN KEY (organization_id, course_id, batch_id)
        REFERENCES course_batches(organization_id, course_id, id) ON DELETE RESTRICT,
    CONSTRAINT fk_class_sessions_allocation FOREIGN KEY (organization_id, course_id, faculty_allocation_id)
        REFERENCES faculty_allocations(organization_id, course_id, id) ON DELETE RESTRICT,
    CONSTRAINT ck_class_sessions_timing CHECK (scheduled_end > scheduled_start),
    CONSTRAINT ck_class_sessions_status CHECK (status IN ('scheduled', 'active', 'completed', 'cancelled'))
);

CREATE INDEX IF NOT EXISTS idx_class_sessions_batch_sched ON class_sessions(organization_id, batch_id, scheduled_start);
CREATE INDEX IF NOT EXISTS idx_class_sessions_status ON class_sessions(status);

-- 11. Attendance Records (Finalized Academic Ledger)
CREATE TABLE IF NOT EXISTS attendance_records (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL,
    batch_id UUID NOT NULL,
    class_session_id UUID NOT NULL,
    student_user_id UUID NOT NULL,
    total_connected_seconds INT NOT NULL DEFAULT 0,
    attendance_status VARCHAR(32) NOT NULL DEFAULT 'absent',
    is_overruled BOOLEAN NOT NULL DEFAULT false,
    original_status VARCHAR(32),
    original_connected_seconds INT,
    overruled_by UUID,
    overrule_reason TEXT,
    overruled_at TIMESTAMPTZ,
    evaluated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT uq_attendance_records_unique UNIQUE (organization_id, class_session_id, student_user_id),
    CONSTRAINT fk_attendance_records_session_batch FOREIGN KEY (organization_id, batch_id, class_session_id)
        REFERENCES class_sessions(organization_id, batch_id, id) ON DELETE RESTRICT,
    CONSTRAINT fk_attendance_records_enrollment FOREIGN KEY (organization_id, batch_id, student_user_id)
        REFERENCES course_enrollments(organization_id, batch_id, student_user_id) ON DELETE RESTRICT,
    CONSTRAINT fk_attendance_records_overruler FOREIGN KEY (overruled_by)
        REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT ck_attendance_status CHECK (attendance_status IN ('present', 'late', 'partial', 'absent'))
);

CREATE INDEX IF NOT EXISTS idx_attendance_records_student ON attendance_records(student_user_id);

-- Trigger: Enforce Temporal Enrollment Validity on Attendance Recording
CREATE OR REPLACE FUNCTION fn_assert_attendance_temporal_eligibility()
RETURNS TRIGGER AS $$
DECLARE
    v_session_start TIMESTAMPTZ;
    v_is_eligible BOOLEAN;
BEGIN
    SELECT scheduled_start INTO v_session_start
    FROM class_sessions
    WHERE id = NEW.class_session_id;

    SELECT (v_session_start <@ ce.valid_during) INTO v_is_eligible
    FROM course_enrollments ce
    WHERE ce.organization_id = NEW.organization_id
      AND ce.batch_id = NEW.batch_id
      AND ce.student_user_id = NEW.student_user_id
    FOR SHARE;

    IF v_is_eligible IS NULL OR NOT v_is_eligible THEN
        RAISE EXCEPTION 'Temporal Eligibility Error: Student % was not actively enrolled in batch % at session time %',
            NEW.student_user_id, NEW.batch_id, v_session_start USING ERRCODE = 'check_violation';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER tr_assert_attendance_temporal_eligibility
    BEFORE INSERT OR UPDATE OF organization_id, batch_id, class_session_id, student_user_id ON attendance_records
    FOR EACH ROW EXECUTE FUNCTION fn_assert_attendance_temporal_eligibility();

-- 12. Attendance Overrule Audit Log (Immutable History of Corrections)
CREATE TABLE IF NOT EXISTS attendance_overrule_audit_log (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
    organization_id UUID NOT NULL,
    attendance_record_id UUID NOT NULL REFERENCES attendance_records(id) ON DELETE RESTRICT,
    class_session_id UUID NOT NULL,
    student_user_id UUID NOT NULL,
    prior_status VARCHAR(32) NOT NULL,
    new_status VARCHAR(32) NOT NULL,
    prior_connected_seconds INT NOT NULL,
    new_connected_seconds INT NOT NULL,
    overruled_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    overrule_reason TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT ck_audit_reason_length CHECK (char_length(trim(overrule_reason)) >= 10)
);

CREATE INDEX IF NOT EXISTS idx_attendance_audit_record ON attendance_overrule_audit_log(attendance_record_id);

-- 13. Expand Existing Rooms Table with Nullable Tenancy Columns
ALTER TABLE rooms
    ADD COLUMN IF NOT EXISTS organization_id UUID,
    ADD COLUMN IF NOT EXISTS class_session_id UUID,
    ADD COLUMN IF NOT EXISTS workspace_type VARCHAR(32);

ALTER TABLE rooms
    ADD CONSTRAINT fk_rooms_organization FOREIGN KEY (organization_id)
        REFERENCES organizations(id) ON DELETE RESTRICT NOT VALID,
    ADD CONSTRAINT fk_rooms_class_session_direct FOREIGN KEY (class_session_id)
        REFERENCES class_sessions(id) ON DELETE RESTRICT NOT VALID,
    ADD CONSTRAINT fk_rooms_class_session_composite FOREIGN KEY (organization_id, class_session_id)
        REFERENCES class_sessions(organization_id, id) ON DELETE RESTRICT NOT VALID,
    ADD CONSTRAINT ck_rooms_session_org CHECK (
        (class_session_id IS NULL) OR (organization_id IS NOT NULL)
    ) NOT VALID;

-- Add composite unique key for downstream event linkage
ALTER TABLE rooms
    ADD CONSTRAINT uq_rooms_tenant_session_id UNIQUE (organization_id, class_session_id, id);

-- 14. Expand Meeting Notes & Meeting Files with Nullable Tenancy Columns
ALTER TABLE meeting_notes
    ADD COLUMN IF NOT EXISTS organization_id UUID,
    ADD COLUMN IF NOT EXISTS workspace_type VARCHAR(32);

ALTER TABLE meeting_notes
    ADD CONSTRAINT fk_meeting_notes_organization FOREIGN KEY (organization_id)
        REFERENCES organizations(id) ON DELETE RESTRICT NOT VALID;

ALTER TABLE meeting_files
    ADD COLUMN IF NOT EXISTS organization_id UUID,
    ADD COLUMN IF NOT EXISTS workspace_type VARCHAR(32);

ALTER TABLE meeting_files
    ADD CONSTRAINT fk_meeting_files_organization FOREIGN KEY (organization_id)
        REFERENCES organizations(id) ON DELETE RESTRICT NOT VALID;

-- 15. Participant Connection Events (Append-Only Immutable Event Ledger)
CREATE TABLE IF NOT EXISTS participant_connection_events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
    organization_id UUID NOT NULL,
    class_session_id UUID NOT NULL,
    room_id UUID NOT NULL,
    user_id UUID,
    identity VARCHAR(128) NOT NULL,
    is_guest BOOLEAN NOT NULL DEFAULT false,
    client_connection_id VARCHAR(64) NOT NULL,
    sequence_number BIGINT NOT NULL,
    event_type VARCHAR(32) NOT NULL,
    client_timestamp TIMESTAMPTZ NOT NULL,
    server_received_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    idempotency_key VARCHAR(128) NOT NULL,
    ip_hash VARCHAR(64) NOT NULL,
    user_agent_summary VARCHAR(128) NOT NULL,
    CONSTRAINT uq_conn_events_idempotency UNIQUE (idempotency_key),
    CONSTRAINT uq_conn_events_stream UNIQUE (room_id, client_connection_id, sequence_number),
    CONSTRAINT ck_conn_events_seq CHECK (sequence_number > 0),
    CONSTRAINT fk_conn_events_room_session FOREIGN KEY (organization_id, class_session_id, room_id)
        REFERENCES rooms(organization_id, class_session_id, id) ON DELETE RESTRICT,
    CONSTRAINT fk_conn_events_user FOREIGN KEY (user_id)
        REFERENCES users(id) ON DELETE RESTRICT,
    CONSTRAINT ck_conn_events_guest CHECK (
        (is_guest = true AND user_id IS NULL) OR (is_guest = false AND user_id IS NOT NULL)
    ),
    CONSTRAINT ck_conn_events_type CHECK (
        event_type IN ('JOIN', 'HEARTBEAT', 'LEAVE', 'DISCONNECT', 'KICK')
    )
);

CREATE INDEX IF NOT EXISTS idx_conn_events_session_user ON participant_connection_events (
    class_session_id, user_id, server_received_at ASC
);
CREATE INDEX IF NOT EXISTS idx_conn_events_ordering ON participant_connection_events (
    room_id, client_connection_id, sequence_number ASC
);

-- 16. Migration Checkpoints (Restartable Keyset Backfill State Tracking)
CREATE TABLE IF NOT EXISTS migration_checkpoints (
    task_name VARCHAR(64) PRIMARY KEY,
    last_processed_id UUID,
    rows_processed BIGINT NOT NULL DEFAULT 0,
    status VARCHAR(32) NOT NULL DEFAULT 'pending', -- 'pending', 'in_progress', 'completed', 'failed'
    error_message TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
