-- Deletions that last (PRD SYNC-005, SYNC-007, OPS-003, OPS-004; AC-17;
-- ADR-0006).
--
-- A deleted record is a tombstone: its row stays, with no ciphertext, so
-- that every device learns of the deletion and no stale device can bring
-- the record back. Tombstones are never removed or compacted.
--
-- Each deletion is also written to an append-only ledger. The ledger holds
-- no content, only which record of which account was deleted and when. It
-- is kept apart from the records table so that the fact of a deletion
-- outlives anything that might later happen to that table, such as a
-- restore from an older backup, which must not bring deleted records back.

CREATE TABLE IF NOT EXISTS warmly_private.deletion_ledger (
    owner_id uuid NOT NULL,
    record_id uuid NOT NULL,
    deleted_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (owner_id, record_id)
);

ALTER TABLE warmly_private.deletion_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE warmly_private.deletion_ledger FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS deletion_ledger_owner_only
    ON warmly_private.deletion_ledger;
CREATE POLICY deletion_ledger_owner_only ON warmly_private.deletion_ledger
    FOR ALL TO warmly_api
    USING (owner_id = warmly_private.current_owner())
    WITH CHECK (owner_id = warmly_private.current_owner());

-- Append-only: no UPDATE and no DELETE.
GRANT SELECT, INSERT ON warmly_private.deletion_ledger TO warmly_api;

-- Deletions made before this table existed are recorded now, so the ledger
-- is complete from its first day. Their time is the tombstone's own.
INSERT INTO warmly_private.deletion_ledger (owner_id, record_id, deleted_at)
     SELECT owner_id, record_id, updated_at
       FROM warmly_private.records
      WHERE tombstone
ON CONFLICT (owner_id, record_id) DO NOTHING;

-- The ledger is written by the database itself, in the same transaction as
-- the tombstone, so no code path can delete a record without it.
--
-- The function runs with the rights of whoever writes the record, not its
-- owner's (it is deliberately not SECURITY DEFINER). The API role may insert
-- into the ledger, and row-level security still confines the insert to the
-- account the transaction is acting for.
CREATE OR REPLACE FUNCTION warmly_private.record_deletion()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    INSERT INTO warmly_private.deletion_ledger (owner_id, record_id)
         VALUES (NEW.owner_id, NEW.record_id)
    ON CONFLICT (owner_id, record_id) DO NOTHING;
    RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS records_record_deletion ON warmly_private.records;
CREATE TRIGGER records_record_deletion
    AFTER INSERT OR UPDATE ON warmly_private.records
    FOR EACH ROW
    WHEN (NEW.tombstone)
    EXECUTE FUNCTION warmly_private.record_deletion();

-- A tombstone is final. The earlier trigger already stops one becoming a
-- live record again; this stops it being changed in any way at all.
CREATE OR REPLACE FUNCTION warmly_private.keep_tombstone_final()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'a deleted record never changes'
        USING ERRCODE = 'check_violation';
END;
$$;

DROP TRIGGER IF EXISTS records_tombstone_is_final ON warmly_private.records;
CREATE TRIGGER records_tombstone_is_final
    BEFORE UPDATE ON warmly_private.records
    FOR EACH ROW
    WHEN (OLD.tombstone)
    EXECUTE FUNCTION warmly_private.keep_tombstone_final();
