# ADR-0017: Tabs tell each other that something changed

- **Status:** Accepted
- **Date:** 2026-11-26
- **PRD references:** §0 invariants 1 and 5, §5.1 [SYNC-001], §4 [SEC-001]
- **Decision register:** D-09, D-12
- **Issue:** #94

## Context

Each tab of an account decrypts the account's records into its own memory
when it is unlocked (ADR-0014). A second tab did not learn what the first
stored until it was unlocked again. Nothing was lost: a write from the
out-of-date tab is refused, and the screen offers the latest version. But
the second tab's lists, counts and status line stayed wrong until then,
and the person found out only by trying to save. ADR-0014 lists this as a
known limit and leaves it for later.

Two things had to be true before tabs could be told. A screen must
already cope with a record changing under it, because that is what being
told means. Sync made that so: it changes records under open screens in
the same tab, and every screen that shows records listens to the store.
And an open form must not lose or overwrite anything when its record is
replaced. ADR-0016 made that so: a change names the copy it was made to,
and is refused when the store no longer holds that copy.

## Decision

**A tab that stores a change says "changed" on a `BroadcastChannel`. A
tab that hears it reads the stored rows again and takes in the ones that
differ from what it holds.**

- **The channel** is named after the account's database, so it reaches
  exactly the tabs that have that database open. It is opened on unlock
  and closed on lock, with the keys. (`src/storage/tab-channel.ts`)
- **The message** is the fixed word `changed`. It names no record and
  holds nothing the person wrote, no ID and no hash. Other pages on the
  same origin could read the channel; there is nothing on it to read.
- **A message is only a reason to read.** Whatever arrives, the tab does
  one thing: it reads the rows from IndexedDB and decrypts the ones whose
  local revision is not the one it holds. A forged message can cause a
  read and nothing else. What a tab shows always comes from rows that
  passed the same decryption and checks as on unlock.
- **Unchanged records keep their copy.** A record whose stored revision is
  the one held is left alone: the very object stays in memory, so a form
  filled from it can still save (ADR-0016). Only a record that did change
  is replaced, and a form open on it is then refused when it saves, and
  offers the latest version, exactly as when sync changes a record.
- **A tab's own newer write wins over an older reading.** Local revisions
  only go up. If a tab stores a change while it is taking in the other
  tab's, the row it read earlier is older than what it now holds and is
  ignored (`holdsCurrent`). A deleted record is always dropped from
  memory: it never comes back.
- **Reading is never announced.** Only a change a tab stored itself is
  announced: a write, a choice between two versions, a page of changes
  from the server, an acknowledgement from the server (which changes what
  is waiting to be sent). Taking in another tab's change says nothing, so
  two tabs cannot answer each other for ever.
- **One reading at a time.** Messages that arrive during a reading ask for
  one more reading afterwards, however many they are.
- **Without `BroadcastChannel`** the store works as before this decision.
  It is not a feature the app requires (`missingFeatures` does not list
  it).

Nothing else changes. The stored format, the outbox, the revision check
inside the write and what the server sees are as they were. No screen was
changed: they already listen to the store.

## Alternatives considered

- **Send the record's kind and ID, and read only that row.** Cheaper for
  the tab that hears it. Rejected for now: the message would then carry
  something about the account's records to anything on the origin, a
  missed or reordered message would leave a tab wrong with no way to
  notice, and a reading of everything puts right whatever was missed.
  If measurements show the reading is too slow for large accounts, the
  message can gain a hint while the reading stays the source of truth.
- **Send the decrypted record.** Rejected outright: plaintext would leave
  the store by a path that is not the encrypted row (invariant 1), and
  the hearing tab would be trusting a message.
- **Use IndexedDB observers or the `storage` event.** There is no
  IndexedDB change event in browsers, and the `storage` event needs a
  write to `localStorage`, where nothing of this app's records may go.
- **Share one worker between tabs** that owns the decrypted records. A
  much larger change, and Safari's support for shared workers is recent.
  Not needed to fix this.
- **Read again when a tab becomes visible.** It would miss two tabs side
  by side, and a tab that is visible the whole time. It could be added
  as a second trigger; the reading is the same.

## Consequences

- A second tab shows what the first stored within a moment: new entries,
  changed ones, deletions, and the counts in the status line.
- Each change in one tab costs the others one read of all rows (still
  encrypted) and one decryption per changed row. Typing a draft in one
  tab makes the other read on each autosave. This is the cost to measure
  first if large accounts feel slow with two tabs open.
- What was built from an entry is checked in every tab that hears of the
  change (`Invalidator` listens to the store). Two tabs can both try to
  delete the same dependent record. One succeeds and the other's attempt
  is refused as out of date, which the invalidator already expects.
- **Limits.** A tab that is locked hears nothing and catches up when it
  is unlocked, by reading everything, as before. A change stored at the
  very moment its tab locks is stored but may not be announced; the other
  tab then learns of it as it did before this decision. An unsaved edit
  (ADR-0015) is read from the database each time it is asked for, so it
  needs no announcement. In builds other than production each tab has
  its own database, and so its own channel: the browser tests exercise
  this decision through unit tests of two stores on one database, not
  through two real tabs.
- The cost of a tab hearing a message it did not need is one read. There
  is no rate limit on the channel; a page on the origin that floods it
  could make tabs read repeatedly, and a page on the origin could already
  do far worse.

## What this supersedes

The "known limit" in ADR-0014 that two tabs of the same account do not
see each other's changes live. The rest of ADR-0014 stands.
