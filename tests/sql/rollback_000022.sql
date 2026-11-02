-- Reverses migration 000022 on a disposable database during verification. This deletes notifications.
DROP FUNCTION IF EXISTS connect_auth.notify_session_people(UUID, TEXT, TEXT, TEXT, TEXT);
DROP FUNCTION IF EXISTS connect_auth.enqueue_job_at(TEXT, TEXT, JSONB, TIMESTAMPTZ);
DROP TABLE IF EXISTS notifications;
DELETE FROM schema_metadata WHERE version = '000022_notifications';
