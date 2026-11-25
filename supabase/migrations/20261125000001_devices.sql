-- Device identities and request signing (PRD DEV-002, DEV-003, SEC-006;
-- ADR-0005).
--
-- Each device registers a public key. Every request is signed with the
-- matching private key, which never leaves the device, so a stolen session
-- token is not enough to act as the account.

-- What a new device must prove it knows before it may register: a value
-- derived one-way from the account root key. It is set once, with the first
-- recovery envelope, and never changes, because rotating the recovery key
-- does not change the root key. It reveals nothing about the root key.
ALTER TABLE warmly_private.recovery_envelopes
    ADD COLUMN IF NOT EXISTS device_enrollment_verifier text
        CHECK (char_length(device_enrollment_verifier) BETWEEN 1 AND 4096);

CREATE TABLE IF NOT EXISTS warmly_private.devices (
    id uuid PRIMARY KEY,
    owner_id uuid NOT NULL,
    -- The device's ECDSA P-256 public key, base64, exactly as registered.
    public_key text NOT NULL CHECK (char_length(public_key) BETWEEN 1 AND 4096),
    -- The device's display name, encrypted on the client. Never decoded here.
    name_ciphertext text NOT NULL
        CHECK (char_length(name_ciphertext) BETWEEN 1 AND 4096),
    created_at timestamptz NOT NULL DEFAULT now(),
    last_sync_at timestamptz,
    revoked_at timestamptz
);

CREATE INDEX IF NOT EXISTS devices_owner_created
    ON warmly_private.devices (owner_id, created_at);

ALTER TABLE warmly_private.devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE warmly_private.devices FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS devices_owner_only ON warmly_private.devices;
CREATE POLICY devices_owner_only ON warmly_private.devices
    FOR ALL TO warmly_api
    USING (owner_id = warmly_private.current_owner())
    WITH CHECK (owner_id = warmly_private.current_owner());

-- No DELETE: a device is revoked, never removed, so its ID can never be
-- registered again.
GRANT SELECT, INSERT, UPDATE ON warmly_private.devices TO warmly_api;

-- Nonces already used by signed requests, kept until the request's timestamp
-- would be refused as stale anyway. A second request with the same nonce is
-- a replay.
CREATE TABLE IF NOT EXISTS warmly_private.device_request_nonces (
    device_id uuid NOT NULL REFERENCES warmly_private.devices (id),
    nonce text NOT NULL CHECK (char_length(nonce) BETWEEN 16 AND 64),
    owner_id uuid NOT NULL,
    expires_at timestamptz NOT NULL,
    PRIMARY KEY (device_id, nonce)
);

CREATE INDEX IF NOT EXISTS device_request_nonces_expiry
    ON warmly_private.device_request_nonces (device_id, expires_at);

ALTER TABLE warmly_private.device_request_nonces ENABLE ROW LEVEL SECURITY;
ALTER TABLE warmly_private.device_request_nonces FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS device_request_nonces_owner_only
    ON warmly_private.device_request_nonces;
CREATE POLICY device_request_nonces_owner_only
    ON warmly_private.device_request_nonces
    FOR ALL TO warmly_api
    USING (owner_id = warmly_private.current_owner())
    WITH CHECK (owner_id = warmly_private.current_owner());

GRANT SELECT, INSERT, DELETE ON warmly_private.device_request_nonces TO warmly_api;
