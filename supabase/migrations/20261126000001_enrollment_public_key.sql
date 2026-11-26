-- Device registration is proved against a public key (ADR-0005, issue 84).
--
-- Until now an account stored an HMAC key ("verifier") derived from its
-- root key, and a new device proved it knew the root key with an HMAC.
-- That value could itself make a proof, so a copy of this table plus a
-- stolen session token was enough to register a device.
--
-- An account now stores the public half of an Ed25519 key pair derived from
-- its root key. A new device signs its registration with the private half.
-- Nothing stored here can make that signature.
--
-- The old value is dropped, not converted: a public key cannot be worked
-- out from it. No deployed database holds an account yet. An envelope
-- written before this migration is left with no key, and such an account
-- cannot register a device (`device.account_not_ready`); see the ADR.

ALTER TABLE warmly_private.recovery_envelopes
    ADD COLUMN IF NOT EXISTS device_enrollment_key text
        CHECK (char_length(device_enrollment_key) = 44);

ALTER TABLE warmly_private.recovery_envelopes
    DROP COLUMN IF EXISTS device_enrollment_verifier;
