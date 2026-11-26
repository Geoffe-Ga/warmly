# ADR-0015: Unsaved edits to a finished entry

- **Status:** Accepted
- **Date:** 2026-11-26
- **PRD references:** §3.2 [JR-006], §4.3 [DEV-005], §5.1 [SYNC-001]; AC-21
- **Decision register:** D-12

## Context

A new entry is saved as a draft while it is typed, so a lock or a closed
page loses nothing. An edit to a finished entry had no such protection:
what was typed lived on the edit screen only, and the inactivity lock, a
reload or a put-away phone tab threw it away.

The fix must not change the entry before the person presses Save changes.
Saving an edit deletes what was built from the entry (ADR-0010), is sent to
the person's other devices, and has no undo. None of that may happen
because a timer fired or the app locked.

## Options

### Option 1: Save the edit as a draft of the entry

Write the form over the entry with `status: "draft"`, as a new entry's
draft is.

- **Pros:** no new storage; reuses `useDraft`.
- **Cons:** the entry is changed, and is no longer a finished one, before
  the person chose that. It would sync, delete its reflections and cards,
  and drop out of the timeline and of Reflect. An abandoned edit could not
  be undone.

### Option 2: Keep the form in `sessionStorage`

- **Pros:** a few lines; gone when the tab closes.
- **Cons:** plaintext journal text in browser storage, which the product
  forbids. Encrypting it there needs the same keys and gives nothing that
  IndexedDB does not.

### Option 3: A second private record, synced like the others

- **Pros:** an edit begun on one device could be finished on another.
- **Cons:** unsaved words would leave the device, which nothing in the PRD
  asks for; a new record kind needs conflict handling, a tombstone and
  dependency rules, all for text the person has not decided to keep.

### Option 4: A local-only encrypted row beside the entry

One envelope per entry in its own IndexedDB store, written and removed by
the edit screen, never queued for sync.

- **Pros:** the entry is untouched; nothing readable is stored; nothing is
  sent; removal is one row.
- **Cons:** a new store and schema version; an edit is recovered only on
  the device it was typed on.

## Comparison

| Dimension | Draft of the entry | sessionStorage | Synced record | Local encrypted row |
| --- | --- | --- | --- | --- |
| Entry unchanged until Save | No | Yes | Yes | Yes |
| Plaintext in browser storage | No | Yes | No | No |
| Unsaved words leave the device | Yes | No | Yes | No |
| Survives a lock and a reload | Yes | A reload only | Yes | Yes |
| New sync surface | No | No | Yes | No |

## Decision

Option 4.

**Storage.** Schema version 3 adds the object store `unfinished`, keyed by
`[type, id]` with the entry's type number and ID. A row holds `type`, `id`,
`envelope` and `schemaVersion`, and nothing else. The envelope is sealed
with `{owner, recordId: id, type: 6}`. Type 6 is used for nothing else, so
an unsaved edit cannot be opened as the entry and the entry cannot be
opened as an unsaved edit. Inside is the form's content (the three answers
and the feelings) and `basedOn`, the content hash of the entry when the
edit began. A row is never written to the outbox and has no revision: it
is not a record, and sync never sees it.

`RecordStore` gains three methods: `unfinished(id)`, `keepUnfinished(id,
edit)` and `dropUnfinished(id)`. `keepUnfinished` checks, in the same
transaction as the write, that the entry is here and not deleted, and
keeps nothing otherwise.

**Deletion.** The row goes with its entry. Every transaction that deletes
an entry also deletes the row: a deletion made here, a deletion that
arrives from the server, and a deletion chosen on the "Changed in two
places" screen. While a deletion made elsewhere is still waiting for the
person's choice, the row stays, like the version it is an edit to.

**The edit screen** (`useEditForm`). What is typed is kept a moment after
typing stops, when the page is hidden or closed, when the screen is left,
and before the app locks (a hook registered with `services.lockHooks`,
ADR-0004). Keeping and removing run one after the other in the order they
were asked for, so a slow "keep" cannot land after a "remove". The row is
removed when:

- the entry is saved (after the entry is stored, never before);
- the person presses Cancel, "Start again from the saved entry" or "Load
  the latest version";
- the form is typed back to what the entry says, or a kept row turns out
  to say what the entry already says.

Leaving the screen any other way is not giving up: the row stays and is
offered next time.

**Offering it back.** When the edit screen opens and a row exists whose
content differs from the entry, the form starts from the row and a notice
says so in fixed words, with a button that goes back to the saved entry.
If `basedOn` is not the entry's content hash now, the entry was changed in
between (on another device, or in another tab); the notice says that
saving will replace what the entry says now. Nothing is merged and nothing
is chosen for the person. A row that cannot be read is ignored and the
form starts from the entry.

**What the page says.** A status line says "Unsaved changes are kept on
this device" once they are, and says so when they could not be kept, with
what to do: the words are still on the page and can be saved.

## Consequences

- An edit survives the inactivity lock, a reload, an update and a closed
  tab, on the device it was typed on. It does not follow the person to
  another device.
- The entry, its reflections and its cards are untouched until Save
  changes. Keeping an edit calls no AI and makes no request.
- The count of rows in `unfinished` tells someone with the device that
  some entries have unsaved edits, and which IDs. It tells them nothing
  about the content. This is the same kind of metadata ADR-0014 accepts.
- Cancel on the edit screen is now a button, because it removes something.
- If the row cannot be removed after a save, it is found to say what the
  entry says the next time the entry is edited, and removed then.
- The edit screen keeps the entry it put on the form (or, with unsaved
  changes brought back, the entry as it was when the person was told what
  saving replaces) and passes it when saving. The store refuses the save
  if it holds a different copy by then, with the same notice as a stale
  tab: sync or another tab changed the entry under the form, and it is
  not replaced unseen (ADR-0016).
- An unsaved edit for an entry that was changed elsewhere is offered with
  a warning, and saving it replaces the newer wording. That is the
  person's choice, made with the warning in front of them; the store's
  stale-copy check (ADR-0014) does not apply, because the screen has read
  the newer entry. Showing the two wordings side by side would be better
  and is not built.
- Signing out or removing the device leaves the rows on the device,
  encrypted, exactly as it leaves the records (ADR-0005).
