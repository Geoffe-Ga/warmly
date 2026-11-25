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
   operation with the record's current envelope (or a tombstone) under the
   `op_id` of its **oldest** queued change. Newer queued changes to the same
   record are covered by that one.
2. **Handle results.**
   - `applied`: the server holds the record as sent. Record the new
     revision as the record's base and clear its queue; if the record
     changed again meanwhile it stays queued on the new base.
   - `duplicate`: an earlier attempt under that ID got through and its
     answer was lost. The server holds the record as it was then. Record
     the revision as the base and clear only that oldest change. If newer
     changes are queued, send again in the same cycle, now on top of it.
     Without this, an edit made after a lost answer would clash with the
     device's own earlier change.
   - `deleted` for a tombstone the device sent: the same as `applied`.
   - Anything else: the record needs the person's attention, and nothing
     local is changed.
3. **Pull.** Ask for changes after the saved cursor until `has_more` is
   false. Each page is stored in **one** local transaction together with
   the new cursor, so a crash leaves the device with the whole page and
   the new cursor, or neither. A change to a record with no unsent local
   changes replaces the local record. A change to a record that has unsent
   local changes is not applied: the server's version is kept beside it,
   still encrypted, in the `parked` store until the person chooses (#36).
   The cursor still moves on, so other records keep syncing.
4. **An unknown cursor.** On `sync.cursor_unknown` the device forgets its
   cursor and reads the feed again from 0, once per cycle.

#### When a cycle runs

`SyncScheduler` (`src/sync/scheduler.ts`) runs a cycle when the app
unlocks, when the network returns, when the page is shown again, about two
seconds after a local change, every two minutes while the page is visible,
and when the person asks. Repeating a cycle is always safe.

- **Backoff.** After a cycle that could not reach the server, or found it
  failing (a 5xx or 429), the next try waits about 2 s, then 4 s, 8 s and
  so on up to 5 minutes, each wait chosen at random from the upper half of
  that. A retry sends the same operations under the same IDs.
- **Not retried on a timer:** a request the server refused (other 4xx), an
  ended session, a revoked device or a wrong clock. Those need something to
  change first; the next unlock, local change or tap tries again.
- **One tab at a time.** Tabs share one local database. A cycle runs under
  a Web Lock named for that database and taken without waiting; a tab that
  does not get it tries again shortly. Where the browser has no Web Locks
  the cycle runs anyway: sending an operation twice is safe.
- **No clocks.** Nothing in the engine reads the time to order changes.
  Timers decide only when to try.

The status shown is one of: "All changes saved", "N changes waiting to
sync", "Couldn't sync. Your writing is saved on this device.", and "Needs
your attention"; while offline the app's offline notice says so. It is a
count and a state, never anything private (SYNC-010). "Needs your
attention" is worked out from the `parked` store, so it is still shown
after a restart.

### What is deliberately left to later issues

- Showing and resolving the two versions of a conflict (#36). Both are
  already kept.
- Browser tests of two devices against the real API and database: they
  need a deployed auth provider (#63).
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

#### The change feed

`GET /v1/sync/changes` reads the caller's records with a sequence above the
cursor, in sequence order.

- **Nothing is skipped.** Step 1 above means one account's changes commit
  one at a time and in sequence order. A reader therefore never sees
  sequence 6 while 5 is still uncommitted, so a cursor it has reached has
  nothing unseen behind it. A database sequence would not give this: two
  transactions could take 5 and 6 and commit in the other order. A change
  that is rolled back gives its number back, so there are no gaps either.
- **Pages are limited twice:** at most 100 records, and a page closes once
  the payloads in it reach about 4 million characters. The first record of
  a page always fits, so the feed always moves forward.
- **An unknown cursor is refused.** A cursor above the highest sequence
  the account has been given gets `409 sync.cursor_unknown`, and the
  client starts again from 0. Answering with an empty page would leave a
  device believing it was up to date.
- **Last sync.** When a device is given the final page (`has_more` false),
  the server records the time as that device's `last_sync_at`, which
  Manage Devices shows (PRD DEV-002). It is a time and nothing else.
