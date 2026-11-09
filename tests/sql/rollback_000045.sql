-- Reverses migration 000045 on a disposable database during verification.
DROP FUNCTION IF EXISTS connect_auth.auth_sso_member(TEXT, TEXT);
DELETE FROM schema_metadata WHERE version = '000045_sso_member_lookup';
