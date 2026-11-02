-- ==============================================================================
-- Rollback: tests/sql/rollback_000030.sql
-- Reverses migration 000030_practical_lab_and_assignments on a disposable database.
-- ==============================================================================

DROP TABLE IF EXISTS lab_student_progress CASCADE;
DROP TABLE IF EXISTS lab_submissions CASCADE;
DROP TABLE IF EXISTS lab_test_cases CASCADE;
DROP TABLE IF EXISTS lab_assignments CASCADE;
DROP TABLE IF EXISTS lab_exercises CASCADE;
DROP TABLE IF EXISTS lab_modules CASCADE;
DROP TABLE IF EXISTS lab_courses CASCADE;

DROP FUNCTION IF EXISTS connect_auth.can_manage_lab_course(UUID);

DELETE FROM schema_metadata WHERE version = '000030_practical_lab_and_assignments';
