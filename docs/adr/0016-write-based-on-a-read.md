# ADR-0016: A write names the copy it was made to

- **Status:** Accepted
- **Date:** 2026-11-26
- **PRD references:** §0 invariant 5 (no last-write-wins), §5.1 [SYNC-001]
- **Decision register:** D-10, D-12
- **Issue:** #134

## Context

The local store refuses a write when its own copy of the record is behind
what is stored (ADR-0014): that catches a second tab. It does not catch a
change that the store itself has already taken in. When sync applies
another device's version of a record while a form for that record is
open, the store's copy is the new one, the form's words are based on the
old one, and the write went through: the other device's wording was
replaced unseen, and the server saw an ordinary change.

Three pull requests closed most of this from the screens' side (#131,
#132, #133): each edit function compared what the form was filled from
with what the store held, and refused on a difference. That was a read
followed by a write. A page of sync changes that landed between the two,
while the new record was being hashed and encrypted, was not caught.

The store already had what is needed. Each record it holds in memory is
one object, with the local revision it was read at, and that object is
replaced only when the stored record changes: on a write, on a reload, and
when sync applies a change from the server. A change this device sent and
then meets again in the feed is `unchanged` (ADR-0006) and replaces
nothing.

## Options

### Option 1: Keep comparing content before the write

- **Pros:** no change to the store; already built.
- **Cons:** two steps, so there is a gap; each kind of record needs its own
  idea of "the same" (answers and feelings, a card's parts, a draft's
  whole record); a comparison helper to maintain.

### Option 2: A revision number returned with each read and passed to `put`

- **Pros:** explicit; the same number the transaction already compares.
- **Cons:** every read has to return a pair, or the caller has to ask for
  the revision in a second call, which is a new gap; every screen and
  domain type has to carry a number that means nothing to it.

### Option 3: `put` takes the copy the change was made to

The caller passes the record object it was given. The store checks that
this is still the object it holds and takes that object's revision as the
one the transaction must find.

- **Pros:** the caller already has the object and needs nothing else; one
  rule for every kind of record; the comparison and the write are one
  step; no helper for "the same content".
- **Cons:** the caller must keep the object the store gave it, not a copy;
  a copy is refused. Any change to a record counts, including one the
  form does not show.

## Comparison

| Dimension | Content compare | Revision number | The read copy |
| --- | --- | --- | --- |
| Gap between check and write | Yes | No, if returned with the read | No |
| Change to every read | No | Yes | No |
| One rule for every record kind | No | Yes | Yes |
| What a caller must hold | The content it showed | A number | The object it was given |
| False refusals | None | None | A copied object; a change the form does not show |

## Decision

Option 3.

`RecordStore.put(kind, record, basedOn?)`. When `basedOn` is given:

1. The store looks at the copy it holds for that ID. If it is not the very
   object `basedOn`, the write is refused with `StaleRecordError` before
   anything is encrypted.
2. Otherwise that copy's revision is the one the write's transaction must
   find on the stored row (the check ADR-0014 already makes). A change
   that lands while the record is being encrypted, in this tab or another,
   moves the row's revision and the transaction refuses.

Step 1 and reading the revision happen in one synchronous step, so
nothing can come between them. `MemoryRecordStore` applies the same rule
by identity.

Who passes what:

- `editEntry`, `editAfter`, `editCard`, `rewriteParts` and
  `chooseAlternative` read the record and pass that read as `basedOn`, so
  the time they spend preparing the new record is covered.
- A screen passes the object it put on the form as `seen`. The edit
  function refuses if the store no longer holds it. The journal edit
  form's `seen` is the entry as it was when the form was filled or, with
  unsaved changes brought back (ADR-0015), when the person was told what
  saving replaces.
- The compose form passes the draft it last read or stored.

After a successful write the object that was stored is the store's copy,
so it is the right `basedOn` for the next change. After a refusal the
caller reads again (`RecordStore.reload`) and shows the person the newer
version; it never writes again without doing so.

## What this supersedes

ADR-0015 says, among its consequences, that the edit screen remembers what
the entry said when it was put on the form and that `editEntry` compares
the answers and the feelings. That consequence is replaced by this
decision: the screen keeps the entry object it was given and the store
compares that. The rest of ADR-0015 stands, and its text is left as it
was written.

## Consequences

- A record is never replaced by a change made to an older copy of it,
  whether the newer copy came from another tab or from sync, and whenever
  it arrived.
- The content comparisons from #131 to #133 are removed. `seen` is now the
  record object, not its content. `sameValue` in `src/domain/same.ts` is no
  longer used by the app; it and its test are kept, because a test file
  under a required suite is not deleted without a person's say-so.
- A caller that clones a record and passes the clone is refused. This is
  deliberate: a clone says nothing about when it was read.
- Any change to a record refuses an edit based on the older copy, even one
  the form does not show, such as a card moved to another collection. The
  person sees the newer version and saves again.
- `reload` gives a new object even when nothing changed, so a second
  screen holding the older object is refused once and reads again.
- A write without `basedOn` behaves as before: it is checked against the
  store's own copy only. New records, and changes that apply to whatever
  is stored now (moving a card, deleting), do not pass one.
- With this in place, refreshing a tab's copies when another tab writes
  (#94) can no longer let a form overwrite what it has not shown: the
  refresh replaces the object, and the form's write is refused.
