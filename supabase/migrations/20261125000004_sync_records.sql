-- Synced records (PRD SYNC-002, SYNC-003, SYNC-008; AC-04, AC-05, AC-16;
-- ADR-0006).
--
-- The server keeps the current state of each record as an opaque payload:
-- the base64 text exactly as the client sent it. It never decodes it, and no
-- column says what a record contains. The primary key starts with the
-- owner, so the same record ID under another account is simply another row.

CREATE TABLE IF NOT EXISTS warmly_private.records (
    owner_id uuid NOT NULL,
    record_id uuid NOT NULL,
    -- An opaque category the client chose. The server never interprets it.
    type smallint NOT NULL CHECK (type BETWEEN 0 AND 255),
    schema_version integer NOT NULL CHECK (schema_version >= 1),
    -- Counts the record's accepted changes, from 1.
    revision bigint NOT NULL CHECK (revision >= 1),
    -- The record's place in the owner's change feed: its latest change.
    sequence bigint NOT NULL CHECK (sequence >= 1),
    tombstone boolean NOT NULL,
    payload text CHECK (char_length(payload) BETWEEN 1 AND 1400000),
    -- A hash of the stored payload text.
    etag text NOT NULL CHECK (char_length(etag) = 64),
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (owner_id, record_id),
    UNIQUE (owner_id, sequence),
    -- A deleted record keeps no ciphertext; a live one always has some.
    CHECK (tombstone = (payload IS NULL))
);

ALTER TABLE warmly_private.records ENABLE ROW LEVEL SECURITY;
ALTER TABLE warmly_private.records FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS records_owner_only ON warmly_private.records;
CREATE POLICY records_owner_only ON warmly_private.records
    FOR ALL TO warmly_api
    USING (owner_id = warmly_private.current_owner())
    WITH CHECK (owner_id = warmly_private.current_owner());

-- No DELETE: a record is replaced or becomes a tombstone, never removed.
GRANT SELECT, INSERT, UPDATE ON warmly_private.records TO warmly_api;

-- Whatever code runs later, a deleted record stays deleted, a record keeps
-- its type, and its revision and place in the feed only ever move forward.
CREATE OR REPLACE FUNCTION warmly_private.keep_record_history()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF OLD.tombstone AND NOT NEW.tombstone THEN
        RAISE EXCEPTION 'a deleted record stays deleted'
            USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.type <> OLD.type THEN
        RAISE EXCEPTION 'a record keeps its type'
            USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.revision <> OLD.revision + 1 OR NEW.sequence <= OLD.sequence THEN
        RAISE EXCEPTION 'a record moves forward one revision at a time'
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS records_keep_history ON warmly_private.records;
CREATE TRIGGER records_keep_history
    BEFORE UPDATE ON warmly_private.records
    FOR EACH ROW
    EXECUTE FUNCTION warmly_private.keep_record_history();

-- One counter per account: the last sequence number handed out. A writer
-- locks its account's row for the length of one operation, so an account's
-- operations are applied one at a time.
CREATE TABLE IF NOT EXISTS warmly_private.owner_sequences (
    owner_id uuid PRIMARY KEY,
    last_sequence bigint NOT NULL CHECK (last_sequence >= 0)
);

ALTER TABLE warmly_private.owner_sequences ENABLE ROW LEVEL SECURITY;
ALTER TABLE warmly_private.owner_sequences FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS owner_sequences_owner_only
    ON warmly_private.owner_sequences;
CREATE POLICY owner_sequences_owner_only ON warmly_private.owner_sequences
    FOR ALL TO warmly_api
    USING (owner_id = warmly_private.current_owner())
    WITH CHECK (owner_id = warmly_private.current_owner());

GRANT SELECT, INSERT, UPDATE ON warmly_private.owner_sequences TO warmly_api;

-- Every operation that was applied, by the ID its device gave it, with the
-- revision it produced. Sending the same operation again finds its receipt
-- and changes nothing.
CREATE TABLE IF NOT EXISTS warmly_private.operation_receipts (
    owner_id uuid NOT NULL,
    op_id uuid NOT NULL,
    record_id uuid NOT NULL,
    revision bigint NOT NULL CHECK (revision >= 1),
    applied_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (owner_id, op_id)
);

ALTER TABLE warmly_private.operation_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE warmly_private.operation_receipts FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS operation_receipts_owner_only
    ON warmly_private.operation_receipts;
CREATE POLICY operation_receipts_owner_only
    ON warmly_private.operation_receipts
    FOR ALL TO warmly_api
    USING (owner_id = warmly_private.current_owner())
    WITH CHECK (owner_id = warmly_private.current_owner());

-- Append-only: no UPDATE and no DELETE.
GRANT SELECT, INSERT ON warmly_private.operation_receipts TO warmly_api;
