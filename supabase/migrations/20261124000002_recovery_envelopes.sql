-- The account root key, wrapped by the user's recovery key (PRD SEC-003).
--
-- One row per account. The server stores the opaque wrapped value only: it
-- never receives the recovery secret or the root key, and it never decodes
-- wrapped_key, so the column holds the base64 text exactly as the client sent
-- it. version counts rotations and is what compare-and-swap checks.

CREATE TABLE IF NOT EXISTS warmly_private.recovery_envelopes (
    owner_id uuid PRIMARY KEY,
    version integer NOT NULL CHECK (version >= 1),
    format_version integer NOT NULL CHECK (format_version >= 1),
    wrapped_key text NOT NULL CHECK (char_length(wrapped_key) BETWEEN 1 AND 4096),
    updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE warmly_private.recovery_envelopes ENABLE ROW LEVEL SECURITY;
ALTER TABLE warmly_private.recovery_envelopes FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS recovery_envelopes_owner_only ON warmly_private.recovery_envelopes;
CREATE POLICY recovery_envelopes_owner_only ON warmly_private.recovery_envelopes
    FOR ALL TO warmly_api
    USING (owner_id = warmly_private.current_owner())
    WITH CHECK (owner_id = warmly_private.current_owner());

-- No DELETE: an account's envelope is replaced, never removed, by the API.
GRANT SELECT, INSERT, UPDATE ON warmly_private.recovery_envelopes TO warmly_api;
