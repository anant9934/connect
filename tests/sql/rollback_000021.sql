-- Reverses migration 000021 on a disposable database during verification. This deletes all responses.
DROP FUNCTION IF EXISTS connect_auth.poll_results(UUID);
DROP FUNCTION IF EXISTS connect_auth.submit_poll_response(UUID, UUID[]);
DROP TABLE IF EXISTS meeting_doubts;
DROP FUNCTION IF EXISTS connect_auth.guard_doubt_update();
DROP TABLE IF EXISTS poll_responses;
DROP TABLE IF EXISTS poll_answer_keys;
DROP TABLE IF EXISTS poll_options;
DROP FUNCTION IF EXISTS connect_auth.poll_room(UUID);
DROP TABLE IF EXISTS polls;
DELETE FROM schema_metadata WHERE version = '000021_polls_quizzes_doubts';
