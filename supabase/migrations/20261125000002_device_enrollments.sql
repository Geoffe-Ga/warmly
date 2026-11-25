-- Device pairing (PRD DEV-001 path A; ADR-0005, D-07).
--
-- A new device asks to be approved by one that is already unlocked. The
-- server only relays the messages of the pairing: public keys, random
-- values, and at the end the root key encrypted to the new device. It can
-- read none of the secrets, and holds each row for a few minutes.

CREATE TABLE IF NOT EXISTS warmly_private.device_enrollments (
    id uuid PRIMARY KEY,
    owner_id uuid NOT NULL,
    -- The new device's ID and its one-time key-transfer public key.
    device_id uuid NOT NULL,
    public_key text NOT NULL CHECK (char_length(public_key) BETWEEN 1 AND 4096),
    -- The new device's commitment to a random value it reveals later.
    commitment text NOT NULL CHECK (char_length(commitment) BETWEEN 1 AND 128),
    -- A random value chosen by the server and bound into the pairing code.
    challenge text NOT NULL CHECK (char_length(challenge) BETWEEN 1 AND 128),
    status text NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'claimed', 'revealed', 'approved', 'rejected')),
    -- The approving device, fixed when it claims the request.
    approver_device_id uuid REFERENCES warmly_private.devices (id),
    approver_nonce text CHECK (char_length(approver_nonce) BETWEEN 1 AND 128),
    joiner_nonce text CHECK (char_length(joiner_nonce) BETWEEN 1 AND 128),
    -- The root key, encrypted to the new device. Never decoded here.
    wrapped_key text CHECK (char_length(wrapped_key) BETWEEN 1 AND 4096),
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS device_enrollments_owner_created
    ON warmly_private.device_enrollments (owner_id, created_at);

ALTER TABLE warmly_private.device_enrollments ENABLE ROW LEVEL SECURITY;
ALTER TABLE warmly_private.device_enrollments FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS device_enrollments_owner_only
    ON warmly_private.device_enrollments;
CREATE POLICY device_enrollments_owner_only
    ON warmly_private.device_enrollments
    FOR ALL TO warmly_api
    USING (owner_id = warmly_private.current_owner())
    WITH CHECK (owner_id = warmly_private.current_owner());

-- DELETE is for clearing out requests that expired long ago.
GRANT SELECT, INSERT, UPDATE, DELETE
    ON warmly_private.device_enrollments TO warmly_api;
