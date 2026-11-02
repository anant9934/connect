-- Reverses migration 000020 on a disposable database during verification. This deletes messages.
DROP TABLE IF EXISTS meeting_hand_raises;
DROP TABLE IF EXISTS meeting_reactions;
DROP TABLE IF EXISTS meeting_messages;
DROP FUNCTION IF EXISTS connect_auth.can_announce(UUID);
DROP FUNCTION IF EXISTS connect_auth.can_use_room(UUID);
DROP FUNCTION IF EXISTS connect_auth.current_room_identity();
DELETE FROM schema_metadata WHERE version = '000020_meeting_interaction';
