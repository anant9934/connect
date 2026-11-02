-- Reverses migration 000029 on a disposable database during verification.
CREATE OR REPLACE FUNCTION connect_auth.can_use_room(p_room_id UUID)
RETURNS BOOLEAN
SECURITY DEFINER SET search_path = pg_catalog, public, connect_auth
LANGUAGE sql STABLE AS $$
    SELECT connect_auth.is_room_member(p_room_id) OR p_room_id = connect_auth.current_guest_room()
$$;

CREATE OR REPLACE FUNCTION connect_auth.can_announce(p_room_id UUID)
RETURNS BOOLEAN
SECURITY DEFINER SET search_path = pg_catalog, public, connect_auth
LANGUAGE sql STABLE AS $$
    SELECT connect_auth.current_user_id() IS NOT NULL
       AND connect_auth.room_access_role(p_room_id, 'user:' || connect_auth.current_user_id()::TEXT) IN ('host', 'co-host')
$$;

CREATE OR REPLACE FUNCTION connect_auth.can_oversee_org(p_org UUID)
RETURNS BOOLEAN
SECURITY DEFINER SET search_path = pg_catalog, public, connect_auth
LANGUAGE sql STABLE AS $$
    SELECT connect_auth.is_super_admin()
        OR (connect_auth.current_org_id() = p_org AND connect_auth.current_role() IN ('institution_admin', 'institution_auditor'))
$$;

CREATE OR REPLACE FUNCTION connect_auth.is_room_moderator_identity(p_room UUID, p_identity TEXT)
RETURNS BOOLEAN
SECURITY DEFINER SET search_path = pg_catalog, public, connect_auth
LANGUAGE sql STABLE AS $$
    SELECT p_identity LIKE 'user:%' AND connect_auth.room_access_role(p_room, p_identity) IN ('host', 'co-host')
$$;

DELETE FROM schema_metadata WHERE version = '000029_fail_closed_checks';
