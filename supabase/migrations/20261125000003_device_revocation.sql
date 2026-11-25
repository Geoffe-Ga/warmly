-- Device revocation (PRD DEV-003, DEV-004; AC-20; ADR-0005).
--
-- A revoked device is refused on every request from then on, and its ID can
-- never be used again. Revocations are also written to an append-only
-- ledger, so that the fact outlives anything that might later happen to the
-- devices table, such as a restore from an older backup.

CREATE TABLE IF NOT EXISTS warmly_private.device_revocations (
    device_id uuid PRIMARY KEY REFERENCES warmly_private.devices (id),
    owner_id uuid NOT NULL,
    -- The device that asked for the revocation. It may be the device itself.
    revoked_by uuid NOT NULL REFERENCES warmly_private.devices (id),
    revoked_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE warmly_private.device_revocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE warmly_private.device_revocations FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS device_revocations_owner_only
    ON warmly_private.device_revocations;
CREATE POLICY device_revocations_owner_only
    ON warmly_private.device_revocations
    FOR ALL TO warmly_api
    USING (owner_id = warmly_private.current_owner())
    WITH CHECK (owner_id = warmly_private.current_owner());

-- Append-only: no UPDATE and no DELETE.
GRANT SELECT, INSERT ON warmly_private.device_revocations TO warmly_api;

-- A revocation cannot be undone or moved in time, whatever code runs later.
CREATE OR REPLACE FUNCTION warmly_private.keep_device_revoked()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF OLD.revoked_at IS NOT NULL
       AND NEW.revoked_at IS DISTINCT FROM OLD.revoked_at THEN
        RAISE EXCEPTION 'a revoked device stays revoked'
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS devices_keep_revoked ON warmly_private.devices;
CREATE TRIGGER devices_keep_revoked
    BEFORE UPDATE ON warmly_private.devices
    FOR EACH ROW
    EXECUTE FUNCTION warmly_private.keep_device_revoked();
