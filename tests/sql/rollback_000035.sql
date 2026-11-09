-- Reverses migration 000035 on a disposable database during verification.
DROP FUNCTION IF EXISTS connect_auth.auth_email_by_member_identifier(TEXT, TEXT);
DROP FUNCTION IF EXISTS connect_auth.reset_password_with_token(TEXT, TEXT);
DROP FUNCTION IF EXISTS connect_auth.issue_self_password_reset(TEXT, TEXT, INT);
DROP FUNCTION IF EXISTS connect_auth.issue_member_password_reset(UUID, UUID, TEXT, INT);
DROP TABLE IF EXISTS password_reset_tokens;
DELETE FROM schema_metadata WHERE version = '000035_password_reset_and_member_login';
