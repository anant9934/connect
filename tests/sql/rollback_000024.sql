-- Reverses migration 000024 on a disposable database during verification.
DROP FUNCTION IF EXISTS connect_auth.org_audit_events(UUID, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, INT, INT);
DROP FUNCTION IF EXISTS connect_auth.org_overview(UUID);
DROP FUNCTION IF EXISTS connect_auth.can_oversee_org(UUID);
DROP INDEX IF EXISTS idx_audit_org_created;
DELETE FROM schema_metadata WHERE version = '000024_admin_dashboard';
