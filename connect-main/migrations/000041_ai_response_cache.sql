-- ==============================================================================
-- Migration: 000041_ai_response_cache.sql
-- Persists AI completions behind the API's in-memory cache, so a restart (such as a free-tier
-- spin-down) does not lose them. Keys are SHA-256 hashes of the organization and the whole
-- request, so one organization can never read another's entries. Only the functions below
-- touch the table.
-- Rollback: tests/sql/rollback_000041.sql
-- ==============================================================================

INSERT INTO schema_metadata (version, description)
VALUES ('000041_ai_response_cache', 'Persistent AI response cache')
ON CONFLICT (version) DO NOTHING;

CREATE TABLE IF NOT EXISTS ai_response_cache (
    cache_key CHAR(64) PRIMARY KEY,
    budget_key VARCHAR(80) NOT NULL,
    model VARCHAR(100) NOT NULL,
    provider VARCHAR(50) NOT NULL,
    content TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    expires_at TIMESTAMPTZ NOT NULL,
    hits INT NOT NULL DEFAULT 0,
    CONSTRAINT ck_ai_cache_key CHECK (cache_key ~ '^[0-9a-f]{64}$'),
    CONSTRAINT ck_ai_cache_size CHECK (octet_length(content) <= 262144),
    CONSTRAINT ck_ai_cache_expiry CHECK (expires_at > created_at AND expires_at <= created_at + INTERVAL '30 days')
);
CREATE INDEX IF NOT EXISTS idx_ai_cache_expiry ON ai_response_cache(expires_at);
CREATE INDEX IF NOT EXISTS idx_ai_cache_budget ON ai_response_cache(budget_key);

ALTER TABLE ai_response_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_response_cache FORCE ROW LEVEL SECURITY;
-- No policies or grants: access is only through the functions below.

CREATE OR REPLACE FUNCTION connect_auth.ai_cache_get(p_key TEXT)
RETURNS TABLE (content TEXT, model VARCHAR, provider VARCHAR)
SECURITY DEFINER SET search_path = pg_catalog, public, connect_auth
LANGUAGE sql AS $$
    UPDATE public.ai_response_cache c SET hits = c.hits + 1
    WHERE c.cache_key = p_key AND c.expires_at > pg_catalog.clock_timestamp()
    RETURNING c.content, c.model, c.provider
$$;

CREATE OR REPLACE FUNCTION connect_auth.ai_cache_put(
    p_key TEXT, p_budget_key TEXT, p_model TEXT, p_provider TEXT, p_content TEXT, p_ttl_seconds INT
)
RETURNS VOID
SECURITY DEFINER SET search_path = pg_catalog, public, connect_auth
LANGUAGE plpgsql AS $$
BEGIN
    IF p_ttl_seconds NOT BETWEEN 60 AND 2592000 OR octet_length(p_content) > 262144 THEN
        RETURN;
    END IF;
    INSERT INTO public.ai_response_cache AS c (cache_key, budget_key, model, provider, content, expires_at)
    VALUES (p_key, pg_catalog.left(p_budget_key, 80), pg_catalog.left(p_model, 100), pg_catalog.left(p_provider, 50), p_content,
            pg_catalog.clock_timestamp() + pg_catalog.make_interval(secs => p_ttl_seconds))
    ON CONFLICT (cache_key) DO UPDATE SET content = EXCLUDED.content, model = EXCLUDED.model,
        provider = EXCLUDED.provider, created_at = pg_catalog.clock_timestamp(), expires_at = EXCLUDED.expires_at;
    -- Keep the table small: clear a few expired entries on each write.
    DELETE FROM public.ai_response_cache c WHERE c.cache_key IN (
        SELECT x.cache_key FROM public.ai_response_cache x WHERE x.expires_at < pg_catalog.clock_timestamp() LIMIT 50);
END;
$$;

REVOKE ALL ON FUNCTION connect_auth.ai_cache_get(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION connect_auth.ai_cache_put(TEXT, TEXT, TEXT, TEXT, TEXT, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION connect_auth.ai_cache_get(TEXT) TO connect_app, connect_worker;
GRANT EXECUTE ON FUNCTION connect_auth.ai_cache_put(TEXT, TEXT, TEXT, TEXT, TEXT, INT) TO connect_app, connect_worker;
