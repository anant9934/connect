-- ==============================================================================
-- Migration: 000016_auth_and_audit_rls.sql
-- users, sessions and security_audit_events had no RLS, so the runtime role could list
-- every account and password hash. Login happens before any session exists, so those
-- lookups go through narrow functions that answer one key at a time.
-- Rollback: tests/sql/rollback_000016.sql
-- ==============================================================================

INSERT INTO schema_metadata (version, description)
VALUES ('000016_auth_and_audit_rls', 'RLS on users, sessions and security audit events')
ON CONFLICT (version) DO NOTHING;

CREATE OR REPLACE FUNCTION connect_auth.auth_user_by_email(p_email TEXT)
RETURNS SETOF public.users
SECURITY DEFINER SET search_path = pg_catalog, public, connect_auth
LANGUAGE sql STABLE AS $$ SELECT u.* FROM public.users u WHERE u.email_normalized = p_email $$;

CREATE OR REPLACE FUNCTION connect_auth.auth_user_by_id(p_id UUID)
RETURNS SETOF public.users
SECURITY DEFINER SET search_path = pg_catalog, public, connect_auth
LANGUAGE sql STABLE AS $$ SELECT u.* FROM public.users u WHERE u.id = p_id $$;

CREATE OR REPLACE FUNCTION connect_auth.auth_user_by_google(p_google_id TEXT)
RETURNS SETOF public.users
SECURITY DEFINER SET search_path = pg_catalog, public, connect_auth
LANGUAGE sql STABLE AS $$ SELECT u.* FROM public.users u WHERE u.google_id = p_google_id $$;

CREATE OR REPLACE FUNCTION connect_auth.auth_session_by_hash(p_token_hash TEXT)
RETURNS SETOF public.sessions
SECURITY DEFINER SET search_path = pg_catalog, public, connect_auth
LANGUAGE sql STABLE AS $$ SELECT s.* FROM public.sessions s WHERE s.token_hash = p_token_hash $$;

CREATE OR REPLACE FUNCTION connect_auth.auth_touch_session(p_id UUID, p_now TIMESTAMPTZ)
RETURNS VOID
SECURITY DEFINER SET search_path = pg_catalog, public, connect_auth
LANGUAGE sql AS $$ UPDATE public.sessions SET last_seen_at = p_now WHERE id = p_id AND revoked_at IS NULL $$;

CREATE OR REPLACE FUNCTION connect_auth.auth_revoke_session(p_id UUID, p_now TIMESTAMPTZ)
RETURNS VOID
SECURITY DEFINER SET search_path = pg_catalog, public, connect_auth
LANGUAGE sql AS $$ UPDATE public.sessions SET revoked_at = p_now WHERE id = p_id $$;

CREATE OR REPLACE FUNCTION connect_auth.auth_revoke_user_sessions(p_user_id UUID, p_now TIMESTAMPTZ)
RETURNS VOID
SECURITY DEFINER SET search_path = pg_catalog, public, connect_auth
LANGUAGE sql AS $$ UPDATE public.sessions SET revoked_at = p_now WHERE user_id = p_user_id AND revoked_at IS NULL $$;

REVOKE ALL ON FUNCTION connect_auth.auth_user_by_email(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION connect_auth.auth_user_by_id(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION connect_auth.auth_user_by_google(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION connect_auth.auth_session_by_hash(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION connect_auth.auth_touch_session(UUID, TIMESTAMPTZ) FROM PUBLIC;
REVOKE ALL ON FUNCTION connect_auth.auth_revoke_session(UUID, TIMESTAMPTZ) FROM PUBLIC;
REVOKE ALL ON FUNCTION connect_auth.auth_revoke_user_sessions(UUID, TIMESTAMPTZ) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION connect_auth.auth_user_by_email(TEXT) TO connect_app;
GRANT EXECUTE ON FUNCTION connect_auth.auth_user_by_id(UUID) TO connect_app;
GRANT EXECUTE ON FUNCTION connect_auth.auth_user_by_google(TEXT) TO connect_app;
GRANT EXECUTE ON FUNCTION connect_auth.auth_session_by_hash(TEXT) TO connect_app;
GRANT EXECUTE ON FUNCTION connect_auth.auth_touch_session(UUID, TIMESTAMPTZ) TO connect_app;
GRANT EXECUTE ON FUNCTION connect_auth.auth_revoke_session(UUID, TIMESTAMPTZ) TO connect_app;
GRANT EXECUTE ON FUNCTION connect_auth.auth_revoke_user_sessions(UUID, TIMESTAMPTZ) TO connect_app;

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE users FORCE ROW LEVEL SECURITY;
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions FORCE ROW LEVEL SECURITY;
ALTER TABLE security_audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE security_audit_events FORCE ROW LEVEL SECURITY;

CREATE POLICY rls_users_self_select ON users
    FOR SELECT USING (id = connect_auth.current_user_id() OR connect_auth.is_super_admin());
CREATE POLICY rls_users_self_update ON users
    FOR UPDATE USING (id = connect_auth.current_user_id()) WITH CHECK (id = connect_auth.current_user_id());
-- Signup and first Google sign-in create the account before any identity exists.
CREATE POLICY rls_users_signup ON users
    FOR INSERT TO connect_app WITH CHECK (true);

CREATE POLICY rls_sessions_self_select ON sessions
    FOR SELECT USING (user_id = connect_auth.current_user_id() OR connect_auth.is_super_admin());
-- A login creates its own session before any context exists.
CREATE POLICY rls_sessions_login ON sessions
    FOR INSERT TO connect_app WITH CHECK (true);

-- Append-only for runtime roles, readable only by platform administrators.
CREATE POLICY rls_audit_events_select ON security_audit_events
    FOR SELECT USING (connect_auth.is_super_admin());
CREATE POLICY rls_audit_events_insert ON security_audit_events
    FOR INSERT TO connect_app, connect_worker WITH CHECK (true);
REVOKE UPDATE, DELETE ON security_audit_events FROM connect_app, connect_worker;
