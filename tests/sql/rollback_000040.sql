-- Reverses migration 000040 on a disposable database during verification.
DROP FUNCTION IF EXISTS connect_auth.quiz_leaderboard(UUID);
DROP FUNCTION IF EXISTS connect_auth.toggle_doubt_vote(UUID);
DROP TABLE IF EXISTS doubt_votes;
DROP FUNCTION IF EXISTS connect_auth.doubt_room(UUID);
DELETE FROM schema_metadata WHERE version = '000040_doubt_votes_and_leaderboard';
