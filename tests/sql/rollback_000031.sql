-- ==============================================================================
-- Rollback: tests/sql/rollback_000031.sql
-- Reverses migration 000031_ai_learning_intelligence on a disposable database.
-- ==============================================================================

DROP TABLE IF EXISTS ai_artifacts CASCADE;
DROP TABLE IF EXISTS ai_usage_ledger CASCADE;
DROP TABLE IF EXISTS ai_organization_policies CASCADE;

DELETE FROM schema_metadata WHERE version = '000031_ai_learning_intelligence';
