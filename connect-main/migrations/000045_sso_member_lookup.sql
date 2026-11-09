-- ==============================================================================
-- Migration: 000045_sso_member_lookup.sql
-- University single sign-on (OpenID Connect) signs in only people who already have an account
-- and an active membership in that institution. This resolves a verified email from the
-- identity provider to that account; it never creates accounts or memberships.
-- Rollback: tests/sql/rollback_000045.sql
-- ==============================================================================

INSERT INTO schema_metadata (version, description)
VALUES ('000045_sso_member_lookup', 'Institution single sign-on member lookup')
ON CONFLICT (version) DO NOTHING;

CREATE OR REPLACE FUNCTION connect_auth.auth_sso_member(p_org_slug TEXT, p_email TEXT)
RETURNS UUID
SECURITY DEFINER SET search_path = pg_catalog, public, connect_auth
LANGUAGE sql STABLE AS $$
    SELECT u.id
    FROM public.users u
    JOIN public.organization_memberships om ON om.user_id = u.id AND om.status = 'active'
    JOIN public.organizations o ON o.id = om.organization_id AND o.status = 'active'
    WHERE o.slug = pg_catalog.lower(pg_catalog.btrim(p_org_slug))
      AND u.email_normalized = pg_catalog.lower(pg_catalog.btrim(p_email))
      AND u.status = 'active'
$$;
REVOKE ALL ON FUNCTION connect_auth.auth_sso_member(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION connect_auth.auth_sso_member(TEXT, TEXT) TO connect_app;
