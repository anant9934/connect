-- ==============================================================================
-- Migration: 000035_password_reset_and_member_login.sql
-- Password reset without an email provider: an institution administrator issues a one-time
-- reset code for a member, or (outside production) the API logs a self-service code.
-- Sign-in by institution and registration number (organization_memberships.member_identifier).
-- Codes are stored only as SHA-256 hashes, expire, and work once. The table has no grants;
-- every access goes through the functions below.
-- Rollback: tests/sql/rollback_000035.sql
-- ==============================================================================

INSERT INTO schema_metadata (version, description)
VALUES ('000035_password_reset_and_member_login', 'Admin-issued password resets and registration number sign-in')
ON CONFLICT (version) DO NOTHING;

CREATE TABLE IF NOT EXISTS password_reset_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash CHAR(64) NOT NULL UNIQUE,
    issued_by UUID REFERENCES users(id) ON DELETE SET NULL,
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    expires_at TIMESTAMPTZ NOT NULL,
    used_at TIMESTAMPTZ,
    CONSTRAINT ck_password_reset_hash CHECK (token_hash ~ '^[0-9a-f]{64}$'),
    CONSTRAINT ck_password_reset_expiry CHECK (expires_at > created_at AND expires_at <= created_at + INTERVAL '24 hours')
);
CREATE INDEX IF NOT EXISTS idx_password_reset_user ON password_reset_tokens(user_id) WHERE used_at IS NULL;

ALTER TABLE password_reset_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE password_reset_tokens FORCE ROW LEVEL SECURITY;
-- No policies and no grants: only the SECURITY DEFINER functions below touch this table.

-- An institution administrator issues a code for a member of their institution. Administrators
-- and auditors cannot be reset this way, so one administrator cannot take over another.
CREATE OR REPLACE FUNCTION connect_auth.issue_member_password_reset(p_org UUID, p_user UUID, p_token_hash TEXT, p_minutes INT)
RETURNS TIMESTAMPTZ
SECURITY DEFINER SET search_path = pg_catalog, public, connect_auth
LANGUAGE plpgsql AS $$
DECLARE
    v_role TEXT;
    v_expires TIMESTAMPTZ := pg_catalog.clock_timestamp() + pg_catalog.make_interval(mins => p_minutes);
BEGIN
    IF NOT (connect_auth.is_super_admin()
            OR (connect_auth.current_org_id() = p_org AND connect_auth.current_role() = 'institution_admin')) THEN
        RAISE EXCEPTION 'only an institution administrator may reset passwords' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF p_user = connect_auth.current_user_id() THEN
        RAISE EXCEPTION 'change your own password from your profile' USING ERRCODE = 'CN409';
    END IF;
    IF p_minutes NOT BETWEEN 5 AND 1440 THEN
        RAISE EXCEPTION 'a reset code lasts 5 minutes to 24 hours' USING ERRCODE = 'CN422';
    END IF;
    SELECT om.role INTO v_role FROM public.organization_memberships om
    WHERE om.organization_id = p_org AND om.user_id = p_user AND om.status = 'active';
    IF v_role IS NULL THEN
        RAISE EXCEPTION 'this person is not an active member' USING ERRCODE = 'CN404';
    END IF;
    IF v_role IN ('institution_admin', 'institution_auditor') AND NOT connect_auth.is_super_admin() THEN
        RAISE EXCEPTION 'administrators reset their passwords themselves' USING ERRCODE = 'insufficient_privilege';
    END IF;
    -- One live code per person: issuing a new one cancels the old.
    UPDATE public.password_reset_tokens t SET used_at = pg_catalog.clock_timestamp()
    WHERE t.user_id = p_user AND t.used_at IS NULL;
    INSERT INTO public.password_reset_tokens (user_id, token_hash, issued_by, organization_id, expires_at)
    VALUES (p_user, p_token_hash, connect_auth.current_user_id(), p_org, v_expires);
    RETURN v_expires;
END;
$$;
REVOKE ALL ON FUNCTION connect_auth.issue_member_password_reset(UUID, UUID, TEXT, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION connect_auth.issue_member_password_reset(UUID, UUID, TEXT, INT) TO connect_app;

-- Self-service code for an email address. The API calls this only outside production, where
-- it logs the code; with no email provider there is no safe way to deliver it in production.
CREATE OR REPLACE FUNCTION connect_auth.issue_self_password_reset(p_email TEXT, p_token_hash TEXT, p_minutes INT)
RETURNS BOOLEAN
SECURITY DEFINER SET search_path = pg_catalog, public, connect_auth
LANGUAGE plpgsql AS $$
DECLARE
    v_user UUID;
BEGIN
    SELECT u.id INTO v_user FROM public.users u
    WHERE u.email_normalized = pg_catalog.lower(pg_catalog.btrim(p_email)) AND u.status = 'active';
    IF v_user IS NULL OR p_minutes NOT BETWEEN 5 AND 1440 THEN
        RETURN false;
    END IF;
    UPDATE public.password_reset_tokens t SET used_at = pg_catalog.clock_timestamp()
    WHERE t.user_id = v_user AND t.used_at IS NULL;
    INSERT INTO public.password_reset_tokens (user_id, token_hash, expires_at)
    VALUES (v_user, p_token_hash, pg_catalog.clock_timestamp() + pg_catalog.make_interval(mins => p_minutes));
    RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION connect_auth.issue_self_password_reset(TEXT, TEXT, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION connect_auth.issue_self_password_reset(TEXT, TEXT, INT) TO connect_app;

-- Uses a code once: sets the new password hash and ends every session. Returns the user, or
-- NULL when the code is unknown, used or expired.
CREATE OR REPLACE FUNCTION connect_auth.reset_password_with_token(p_token_hash TEXT, p_password_hash TEXT)
RETURNS UUID
SECURITY DEFINER SET search_path = pg_catalog, public, connect_auth
LANGUAGE plpgsql AS $$
DECLARE
    v_token UUID;
    v_user UUID;
    v_now TIMESTAMPTZ := pg_catalog.clock_timestamp();
BEGIN
    SELECT t.id, t.user_id INTO v_token, v_user FROM public.password_reset_tokens t
    WHERE t.token_hash = p_token_hash AND t.used_at IS NULL AND t.expires_at > v_now
    FOR UPDATE;
    IF v_token IS NULL THEN
        RETURN NULL;
    END IF;
    UPDATE public.password_reset_tokens SET used_at = v_now WHERE id = v_token;
    UPDATE public.users SET password_hash = p_password_hash, updated_at = v_now WHERE id = v_user AND status = 'active';
    IF NOT FOUND THEN
        RETURN NULL;
    END IF;
    UPDATE public.sessions SET revoked_at = v_now WHERE user_id = v_user AND revoked_at IS NULL;
    RETURN v_user;
END;
$$;
REVOKE ALL ON FUNCTION connect_auth.reset_password_with_token(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION connect_auth.reset_password_with_token(TEXT, TEXT) TO connect_app;

-- Sign-in by institution and registration number resolves to the account's email; the
-- password check is then the normal one. Inactive memberships and institutions never resolve.
CREATE OR REPLACE FUNCTION connect_auth.auth_email_by_member_identifier(p_org_slug TEXT, p_identifier TEXT)
RETURNS TEXT
SECURITY DEFINER SET search_path = pg_catalog, public, connect_auth
LANGUAGE sql STABLE AS $$
    SELECT u.email_normalized
    FROM public.organizations o
    JOIN public.organization_memberships om ON om.organization_id = o.id
    JOIN public.users u ON u.id = om.user_id
    WHERE o.slug = pg_catalog.lower(pg_catalog.btrim(p_org_slug)) AND o.status = 'active'
      AND om.member_identifier = pg_catalog.btrim(p_identifier) AND om.status = 'active'
$$;
REVOKE ALL ON FUNCTION connect_auth.auth_email_by_member_identifier(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION connect_auth.auth_email_by_member_identifier(TEXT, TEXT) TO connect_app;
