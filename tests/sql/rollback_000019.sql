-- Reverses migration 000019 on a disposable database during verification.
ALTER POLICY rls_attendance_policies_service ON attendance_policies
    USING (connect_auth.is_super_admin() OR CURRENT_USER IN ('connect_app', 'connect_worker'))
    WITH CHECK (connect_auth.is_super_admin() OR CURRENT_USER IN ('connect_app', 'connect_worker'));

CREATE OR REPLACE FUNCTION connect_auth.can_enter_room(p_room_id UUID, p_identity TEXT)
RETURNS BOOLEAN
SECURITY DEFINER
SET search_path = pg_catalog, public, connect_auth
LANGUAGE plpgsql STABLE AS $$
DECLARE
    v_workspace TEXT;
    v_org UUID;
BEGIN
    SELECT r.workspace_type, r.organization_id INTO v_workspace, v_org
    FROM public.rooms r WHERE r.id = p_room_id;
    IF NOT FOUND THEN
        RETURN false;
    END IF;
    IF v_workspace IS DISTINCT FROM 'institutional' THEN
        RETURN true;
    END IF;
    RETURN p_identity LIKE 'user:%' AND EXISTS (
        SELECT 1 FROM public.organization_memberships om
        WHERE om.organization_id = v_org
          AND 'user:' || om.user_id::TEXT = p_identity
          AND om.status = 'active'
    );
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_class_session_from_room ON rooms;
DROP FUNCTION IF EXISTS connect_auth.sync_class_session_from_room();
DROP FUNCTION IF EXISTS connect_auth.sync_session_room(UUID);
DROP FUNCTION IF EXISTS connect_auth.create_session_room(UUID, TEXT);
DROP FUNCTION IF EXISTS connect_auth.can_manage_session(UUID);
DROP FUNCTION IF EXISTS connect_auth.session_conflict(UUID, UUID, UUID, TIMESTAMPTZ, TIMESTAMPTZ, UUID);
DROP FUNCTION IF EXISTS connect_auth.org_members(UUID);
DROP FUNCTION IF EXISTS connect_auth.org_add_member(UUID, TEXT, TEXT, TEXT);
DROP FUNCTION IF EXISTS connect_auth.my_organizations();
DROP INDEX IF EXISTS idx_class_sessions_window;
DROP INDEX IF EXISTS idx_class_sessions_series;
ALTER TABLE class_sessions DROP COLUMN IF EXISTS time_zone, DROP COLUMN IF EXISTS series_id;
DELETE FROM schema_metadata WHERE version = '000019_institution_management';
