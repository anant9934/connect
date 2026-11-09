-- Reverses migration 000044 on a disposable database during verification.
ALTER TABLE courses DROP CONSTRAINT IF EXISTS fk_courses_degree_program;
ALTER TABLE courses DROP COLUMN IF EXISTS degree_program_id;
DROP TABLE IF EXISTS degree_programs;
ALTER TABLE departments DROP CONSTRAINT IF EXISTS fk_departments_school;
ALTER TABLE departments DROP COLUMN IF EXISTS school_id;
DROP TABLE IF EXISTS schools;
DELETE FROM schema_metadata WHERE version = '000044_schools_and_programs';
