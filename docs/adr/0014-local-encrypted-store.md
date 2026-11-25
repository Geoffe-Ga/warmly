# ADR-0014: The local encrypted record store

- **Status:** Accepted
- **Date:** 2026-11-25
- **PRD references:** §5.1 [SYNC-001, SYNC-002], §7, §10 [REL-004], §13.6; AC-03
- **Decision register:** D-09, D-12

## Context

Journal entries were held in memory and lost on every lock and reload. They
must now survive both, on a device that may be offline for weeks, without
anything readable being written to the browser's storage. Later work syncs
the same records to the server, so each local change must be queued in a way
that cannot drift from the data it describes.

## Options

### Option 1: One encrypted blob for the whole account

- **Pros:** simplest to write; hides how many records there are.
- **Cons:** every save rewrites everything; one damaged write loses
  everything; nothing to sync record by record; no per-record revision.

### Option 2: One row per record, envelope beside plain sync metadata, with an outbox written in the same transaction

- **Pros:** a save touches one row; the server can sync and compare
  revisions per record without seeing content; the queue cannot disagree
  with the data.
- **Cons:** the record's ID, type number, revisions and the count of records
  are readable on the device. None of it is content.

### Option 3: A library (Dexie, RxDB) with an encryption plug-in

- **Pros:** less code for queries and migrations.
- **Cons:** a runtime dependency in the most sensitive path; encryption
  plug-ins bring their own crypto and key handling, against ADR-0003; the
  queries they make easy need plaintext indexes, which are forbidden here.

## Comparison

| Dimension | One blob | Row per record + outbox | Library |
| --- | --- | --- | --- |
| Plaintext on disk | None | None (metadata only) | Depends on plug-in |
| Cost of one save | Whole account | One row | One row |
| Fits per-record sync (SYNC-002) | No | Yes | Partly |
| New dependencies | 0 | 0 | 1 or more |

## Decision

Option 2, written directly on IndexedDB.

**Database.** One database per account, `warmly-records-<owner>`, so two
accounts in one browser never share a key space. Schema version 1 has two
object stores:

- `records`, keyed by `[type, id]`: `type`, `id`, `envelope` (ADR-0003
  bytes, or `null` once deleted), `schemaVersion`, `localRevision`,
  `baseRevision`, `tombstone`, `dirty`.
- `outbox`, keyed by an auto-incrementing `seq`: `opId` (a fresh random
  UUID), `type`, `id`, `localRevision`, `baseRevision`, `schemaVersion`,
  `tombstone`.

Nothing else is stored. No record content, content hash, search index or
decrypted cache is ever written. A test writes a canary sentence and scans
every stored value for it.

**Envelope context.** A record is sealed with `{owner, recordId: id, type}`.
Type numbers are fixed in `encrypted-record-store.ts` (journal entry = 1;
16 is already used for device names) and are never reused. On load the ID
inside the record must equal the ID of its row.

**One transaction per change.** `put` and `delete` encrypt first, then
write the row and its outbox operation in a single read-write transaction.
The revision is read inside that transaction, so two writes cannot claim
the same one. If any part fails, neither is stored.

**No silent overwrite.** The store remembers the local revision each record
was read at. A `put` is refused (`StaleRecordError`) unless the stored row
is still at that revision, or is absent when the store holds no copy. So a
tab with an out-of-date copy cannot replace another tab's newer record, and
a row this version cannot read is never written over. The refused tab sees
the newer record after its next unlock.

**Deletion.** A delete replaces the row with a tombstone that has no
envelope, and queues a tombstone operation. A `put` onto a tombstone is
refused (`RecordDeletedError`): a deletion is never undone by a later write.

**Lock.** Decrypted records live only in the store object's memory between
`unlock(root, owner)` and `lock()`. The vault calls `unlock` when it adopts
the root key; `dropSecrets` calls `lock`. While locked, reads return nothing
and writes are refused (`StoreLockedError`); a write that was encrypting when
the lock happened is refused too.

**Fail closed (§13.6).**

- A database with a higher version than this code knows is not opened
  (`NewerDatabaseError`); every read and write fails and the journal says so.
- A row this code cannot read (another key, a newer `schemaVersion`, an
  unknown envelope format, a wrong shape) is left untouched and counted; the
  journal says how many entries it could not show.

**Migrations.** `MIGRATIONS` in `db.ts` holds one step per version. Steps are
forward-only and never edited after release. Each version has a committed
dump under `tests/fixtures/idb/`; the tests rebuild a database from every
dump, open it with the current code and check every record still decrypts
and the outbox is intact. A test fails if a version has no dump.

## Consequences

- Entries survive lock, reload and offline use. The outbox fills but is not
  sent anywhere until the sync engine exists (ADR-0006, #32).
- Unlock decrypts every record into memory. That is what local search needs
  anyway, and is fine for thousands of entries; it must be measured before
  the account sizes in PRD §10 are claimed.
- **Two tabs of the same account do not see each other's changes live.**
  Each has its own in-memory copy until it is unlocked again. Nothing is
  lost: a write from the out-of-date tab is refused, and the screen offers
  to load the latest version (`RecordStore.reload` re-reads one record),
  which replaces what was typed there. Telling tabs about each other's
  changes as they happen is left for later.
- The database name contains the account ID. Anyone who can read the
  browser profile can see which accounts have been used in it. It is not
  content, and the same ID is already in the stored auth session.
- The browser may evict IndexedDB under storage pressure. Until sync exists
  an entry lives on one device only. The app asks for persistent storage
  each time it is unlocked (`navigator.storage.persist`) and Settings shows
  the browser's answer as it is; the browser may still say no.
- Storage failures are typed (`src/storage/errors.ts`): a full device, a
  browser that will not allow storage, another tab blocking an upgrade, and
  a database from a newer version. Each has its own message and next step,
  and what the person typed stays on the page.
- Changing a record's shape means a new `schemaVersion` and a reader for the
  old one; changing the stores means a new migration step and a new dump.
