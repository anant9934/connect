-- Reverses migration 000041 on a disposable database during verification.
DROP FUNCTION IF EXISTS connect_auth.ai_cache_put(TEXT, TEXT, TEXT, TEXT, TEXT, INT);
DROP FUNCTION IF EXISTS connect_auth.ai_cache_get(TEXT);
DROP TABLE IF EXISTS ai_response_cache;
DELETE FROM schema_metadata WHERE version = '000041_ai_response_cache';
