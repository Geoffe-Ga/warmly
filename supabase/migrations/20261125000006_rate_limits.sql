-- Request rate limits (PRD §8, SEC-005; AC-20).
--
-- One counter per account, and one per device of that account, for the
-- current window of time. The counters live in the database so the limit
-- holds however many copies of the API are running. A row says how many
-- requests were made and when the window began: nothing about what was
-- asked for.

CREATE TABLE IF NOT EXISTS warmly_private.rate_limits (
    owner_id uuid NOT NULL,
    -- 'account', or 'device:' followed by a device ID.
    scope text NOT NULL CHECK (char_length(scope) BETWEEN 1 AND 64),
    window_start timestamptz NOT NULL,
    count integer NOT NULL CHECK (count >= 1),
    PRIMARY KEY (owner_id, scope)
);

ALTER TABLE warmly_private.rate_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE warmly_private.rate_limits FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS rate_limits_owner_only ON warmly_private.rate_limits;
CREATE POLICY rate_limits_owner_only ON warmly_private.rate_limits
    FOR ALL TO warmly_api
    USING (owner_id = warmly_private.current_owner())
    WITH CHECK (owner_id = warmly_private.current_owner());

-- DELETE is for counters from windows that have ended.
GRANT SELECT, INSERT, UPDATE, DELETE ON warmly_private.rate_limits TO warmly_api;
