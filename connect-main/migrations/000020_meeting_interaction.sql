-- ==============================================================================
-- Migration: 000020_meeting_interaction.sql
-- Chat, announcements, reactions and raised hands are stored, so a reload or reconnect recovers
-- them and a data channel can never forge them. Messages are append-only for the API role.
-- Rollback: tests/sql/rollback_000020.sql
-- ==============================================================================

INSERT INTO schema_metadata (version, description)
VALUES ('000020_meeting_interaction', 'Persisted meeting chat, announcements, reactions and raised hands')
ON CONFLICT (version) DO NOTHING;

CREATE TABLE IF NOT EXISTS meeting_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    seq BIGINT GENERATED ALWAYS AS IDENTITY,
    room_id UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    sender_identity VARCHAR(128) NOT NULL,
    sender_name VARCHAR(100) NOT NULL,
    kind VARCHAR(16) NOT NULL DEFAULT 'chat',
    body TEXT NOT NULL,
    client_message_id VARCHAR(64) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT uq_meeting_messages_retry UNIQUE (room_id, sender_identity, client_message_id),
    CONSTRAINT ck_meeting_messages_kind CHECK (kind IN ('chat', 'announcement')),
    CONSTRAINT ck_meeting_messages_body CHECK (char_length(body) BETWEEN 1 AND 2000)
);

CREATE INDEX IF NOT EXISTS idx_meeting_messages_room_seq ON meeting_messages(room_id, seq);

CREATE TABLE IF NOT EXISTS meeting_reactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    room_id UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    identity VARCHAR(128) NOT NULL,
    emoji VARCHAR(16) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX IF NOT EXISTS idx_meeting_reactions_room_time ON meeting_reactions(room_id, created_at);

-- History of hands, so engagement can count them. A row with no lowered_at is a raised hand.
CREATE TABLE IF NOT EXISTS meeting_hand_raises (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    room_id UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    identity VARCHAR(128) NOT NULL,
    raised_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    lowered_at TIMESTAMPTZ,
    lowered_by VARCHAR(128)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_meeting_hand_one_raised ON meeting_hand_raises(room_id, identity) WHERE lowered_at IS NULL;

ALTER TABLE meeting_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE meeting_messages FORCE ROW LEVEL SECURITY;
ALTER TABLE meeting_reactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE meeting_reactions FORCE ROW LEVEL SECURITY;
ALTER TABLE meeting_hand_raises ENABLE ROW LEVEL SECURITY;
ALTER TABLE meeting_hand_raises FORCE ROW LEVEL SECURITY;

-- The identity of whoever this transaction authenticated, user or guest.
CREATE OR REPLACE FUNCTION connect_auth.current_room_identity()
RETURNS TEXT
SECURITY DEFINER SET search_path = pg_catalog, public, connect_auth
LANGUAGE sql STABLE AS $$
    SELECT COALESCE('user:' || connect_auth.current_user_id()::TEXT, connect_auth.current_guest_identity())
$$;

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

REVOKE ALL ON FUNCTION connect_auth.current_room_identity() FROM PUBLIC;
REVOKE ALL ON FUNCTION connect_auth.can_use_room(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION connect_auth.can_announce(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION connect_auth.current_room_identity() TO connect_app, connect_worker;
GRANT EXECUTE ON FUNCTION connect_auth.can_use_room(UUID) TO connect_app, connect_worker;
GRANT EXECUTE ON FUNCTION connect_auth.can_announce(UUID) TO connect_app, connect_worker;

CREATE POLICY rls_messages_select ON meeting_messages FOR SELECT
    USING (connect_auth.is_super_admin() OR connect_auth.can_use_room(room_id));
CREATE POLICY rls_messages_insert ON meeting_messages FOR INSERT
    WITH CHECK (
        connect_auth.can_use_room(room_id)
        AND sender_identity = connect_auth.current_room_identity()
        AND (kind = 'chat' OR connect_auth.can_announce(room_id))
    );

CREATE POLICY rls_reactions_select ON meeting_reactions FOR SELECT
    USING (connect_auth.is_super_admin() OR connect_auth.can_use_room(room_id));
CREATE POLICY rls_reactions_insert ON meeting_reactions FOR INSERT
    WITH CHECK (connect_auth.can_use_room(room_id) AND identity = connect_auth.current_room_identity());

CREATE POLICY rls_hands_select ON meeting_hand_raises FOR SELECT
    USING (connect_auth.is_super_admin() OR connect_auth.can_use_room(room_id));
CREATE POLICY rls_hands_insert ON meeting_hand_raises FOR INSERT
    WITH CHECK (connect_auth.can_use_room(room_id) AND identity = connect_auth.current_room_identity());
-- A participant lowers their own hand. Moderators with the mute permission lower anyone's.
CREATE POLICY rls_hands_update ON meeting_hand_raises FOR UPDATE
    USING (identity = connect_auth.current_room_identity() OR connect_auth.is_room_moderator(room_id, 'mute'))
    WITH CHECK (identity = connect_auth.current_room_identity() OR connect_auth.is_room_moderator(room_id, 'mute'));

GRANT SELECT, INSERT ON meeting_messages, meeting_reactions TO connect_app;
GRANT SELECT, INSERT, UPDATE ON meeting_hand_raises TO connect_app;
REVOKE UPDATE, DELETE ON meeting_messages, meeting_reactions FROM connect_app;
REVOKE DELETE ON meeting_hand_raises FROM connect_app;
-- Engagement reporting reads these through the worker; it changes none of them.
GRANT SELECT ON meeting_messages, meeting_reactions, meeting_hand_raises TO connect_worker;
CREATE POLICY rls_messages_worker ON meeting_messages FOR SELECT TO connect_worker USING (true);
CREATE POLICY rls_reactions_worker ON meeting_reactions FOR SELECT TO connect_worker USING (true);
CREATE POLICY rls_hands_worker ON meeting_hand_raises FOR SELECT TO connect_worker USING (true);
