# ADR-0006: The sync protocol

- **Status:** Accepted
- **Date:** 2026-11-25
- **PRD references:** §5.2 [SYNC-002 to SYNC-011], §4.2 [SEC-007], §9 [OPS-003]; AC-17, AC-23
- **Decision register:** D-10

## Context

Each device keeps its records encrypted in IndexedDB and queues every
change in an outbox (ADR-0014). The devices of one account must converge on
the same records through a server that only ever holds ciphertext, while a
device may be offline for weeks, may be suspended mid-request, and may send
the same request twice. Two devices can change one record from the same
starting point, and a deleted record must never come back.

## Options

### Option 1: Last write wins, by timestamp

- **Pros:** simplest server and client.
- **Cons:** silently discards one device's writing; depends on device
  clocks; a stale device can resurrect a deletion. Forbidden by the PRD.

### Option 2: Per-record revisions with compare-and-swap, an idempotent operation log, and a per-owner change feed

- **Pros:** the server never chooses between two versions; a repeated
  request has no second effect; a device catches up from a single number;
  the server needs no knowledge of what a record contains.
- **Cons:** conflicts must be resolved by the person on a device; the
  server must keep tombstones and operation IDs.

### Option 3: CRDTs merged on the client

- **Pros:** concurrent edits merge without a conflict step.
- **Cons:** a journal answer is prose, where an automatic merge of two
  rewrites is rarely what either device meant; much larger encrypted state;
  a new dependency in the most sensitive path.

## Comparison

| Dimension | Last write wins | Revisions + CAS | CRDT |
| --- | --- | --- | --- |
| Loses writing silently | Yes | No | No |
| Depends on device clocks | Yes | No | No |
| Deleted records can return | Yes | No | Depends |
| Server understands content | No | No | No |
| New dependencies | 0 | 0 | 1 or more |

## Decision

Option 2.

### Records and revisions

The server stores, per owner, the current state of each record:
`record_id` (an opaque UUID), `type` (0 to 255, never interpreted),
`schema_version`, `revision`, `sequence`, `tombstone`, an `etag` (a hash of
the ciphertext) and the `payload` (the ADR-0003 envelope, base64), or no
payload for a tombstone.

- `revision` counts the record's accepted changes, from 1. The server
  assigns it.
- `sequence` is the record's place in the owner's change feed. Each
  accepted change takes the next number from a per-owner counter, so a
  record has exactly one place in the feed: its latest.

Nothing the server stores or logs says what a record contains. The content
hash of a journal entry is inside the envelope and is never sync metadata.

### Operations: `POST /v1/sync/operations`

A batch of 1 to 100 operations. Each carries `op_id` (a fresh UUID chosen
by the device), `record_id`, `type`, `base_revision` (the revision the
change was made on top of; 0 for a record the device has never seen on the
server), `schema_version`, `tombstone`, and `payload` (absent exactly when
`tombstone` is true). Operations are applied in order, each on its own, and
each gets one result in the same order.

| # | Scenario | Stored record | Operation | Status | Effect |
| --- | --- | --- | --- | --- | --- |
| 1 | Create | none | base 0, payload | `applied` | revision 1 |
| 2 | Update | live, revision 1 | base 1, payload | `applied` | revision 2 |
| 3 | Stale update | live, revision 2 | base 1, payload | `conflict` | none; `current_revision` 2 |
| 4 | Delete | live, revision 2 | base 2, tombstone | `applied` | revision 3, payload removed |
| 5 | Duplicate operation | any | an `op_id` already applied | `duplicate` | none; the `revision` it produced |
| 6 | Edit after delete | tombstone, revision 3 | any base, payload | `deleted` | none; `current_revision` 3 |
| 7 | Delete after delete | tombstone, revision 3 | any base, tombstone | `deleted` | none; `current_revision` 3 |
| 8 | Stale delete | live, revision 2 | base 1, tombstone | `conflict` | none; `current_revision` 2 |
| 9 | Delete of a record never synced | none | base 0, tombstone | `applied` | revision 1, a tombstone |
| 10 | Update of a record never synced | none | base 1, payload | `rejected` | none |
| 11 | Another record type | live, type 1 | same `record_id`, type 2 | `rejected` | none |

- `applied` and `duplicate` carry `revision`. `conflict` and `deleted` carry
  `current_revision`. `rejected` carries neither.
- An `op_id` is remembered only once it has been applied. Sending an
  operation that was not applied again evaluates it again, with the same
  outcome unless the record has changed.
- The server never merges and never picks a winner. On `conflict` both
  versions exist: the server's, and the one on the device that was refused.
- A tombstone is never replaced by a live record. A deleted record cannot
  be brought back by any device (rows 6 and 7).
- `tests/fixtures/sync/scenarios-v1.json` is this table in a form tests can
  run. The in-memory server used by client tests
  (`src/sync/testing/memory-server.ts`) and the real backend must both pass
  it.

### Change feed: `GET /v1/sync/changes?cursor=N`

Returns the owner's records whose `sequence` is greater than the cursor, in
`sequence` order, as their current state, in pages. `next_cursor` is the
last `sequence` returned, or the cursor that was sent when the page is
empty. `has_more` says whether to ask again. A device starts at cursor 0.

Because a record has only its latest place in the feed, a device that is
far behind receives each record once, in its newest form, tombstones
included.

### The client

One cycle is a push and then a pull:

1. **Push.** Read the outbox. For each record with unsent changes send one
   operation with the record's current envelope (or a tombstone) and the
   `op_id` of its newest queued change. Older queued changes to the same
   record are covered by that one.
2. **Handle results.** `applied` or `duplicate`: record the new revision as
   the record's base and clear what was sent from the outbox; if the record
   changed again meanwhile it stays queued on the new base. `deleted` for a
   tombstone the device sent: the same. Anything else: the record needs the
   person's attention, and nothing local is changed.
3. **Pull.** Ask for changes after the cursor until `has_more` is false.
   A change to a record with no unsent local changes replaces the local
   record. A change to a record that has unsent local changes is not
   applied: both versions are kept for the person to resolve (#36).

A cycle runs when the app is unlocked, when the network returns, and when
the person asks. Repeating a cycle is always safe.

The status shown is one of: "All changes saved", "N changes waiting to
sync", "Offline: your writing is saved on this device." and "Needs your
attention". It is a count and a state, never anything private (SYNC-010).

### What is deliberately left to later issues

- The server's change feed (#34). Until then `GET /v1/sync/changes` is a
  stub marked `Warmly-Stub: true`; the client treats a stub as "sync is not
  available" and keeps changes queued. `POST /v1/sync/operations` is real
  (see "The server's side" below).
- A persisted cursor, retry with backoff, and partial-failure handling (#35).
- Keeping and resolving both versions of a conflict (#36).
- Tombstone retention, compaction and a deletion ledger (#37, #65).
- Rate limits and cross-account tests (#38); schema negotiation (#39).

## Consequences

- No device clock is trusted for ordering. Clock skew cannot reorder or
  lose changes.
- A request can be repeated freely. This is sync retry only; AI calls are
  never retried automatically.
- The person, on a device, resolves conflicts. Until #36 a conflict shows
  as "Needs your attention" and neither version is discarded.
- The server must keep tombstones for as long as any device or backup
  could still hold the record (#37).
- Drafts sync like any other record. Autosave queues many changes to one
  draft; the push sends one operation per record, not one per change.

### The server's side

`POST /v1/sync/operations` applies each operation in its own database
transaction (`warmly/db/sync_store.py`), in the order sent:

1. Lock the account's counter row. This makes one account's operations run
   one at a time, so what is read next is still true when the write happens.
   Different accounts never wait for each other.
2. If this `op_id` was already applied, answer `duplicate` with the revision
   it produced and change nothing.
3. Read the record and apply the refusal rules (`rejected`, `deleted`,
   `conflict`). A refused operation stores nothing: no row, no receipt, no
   place in the feed.
4. Otherwise take the account's next sequence number, write the record at
   `base_revision + 1` (the update's `WHERE revision = base` is the
   compare-and-swap), and store the receipt.

The database enforces the rest whatever the code does: the API role cannot
delete a record or change a receipt, a trigger keeps a tombstone deleted and
moves a record forward exactly one revision at a time, and row-level
security keeps every row to its owner. The same record ID under another
account is another row, so one account cannot tell whether another has a
given record. The ETag is a SHA-256 of the payload text as sent; the server
never decodes a payload.

One operation per transaction means a batch is not all-or-nothing: each
operation gets its own answer, which is what the client's outbox expects.
