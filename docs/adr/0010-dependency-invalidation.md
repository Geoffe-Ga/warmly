# ADR-0010: Removing what was built from a journal entry that has changed

- **Status:** Accepted
- **Date:** 2026-11-26
- **PRD references:** §5.3 [DEP-001 to DEP-008], §5.2 [SYNC-006, SYNC-007], §3.3 [RF-011], §13.7; AC-12, AC-17, AC-03
- **Decision register:** D-13; D-14, amended here

## Context

An AI answer is written from particular words in the journal. When the
person changes or deletes those words, the answer may still repeat or
paraphrase them. Invariant 6 says such output is removed, locally, with no
AI call. The server holds only ciphertext and cannot know what depends on
what, so every device must come to the same result by itself, whatever
order changes reach it in, and a deletion must not come back from a device
that was away (AC-17).

## Options

### Where the dependency is recorded

1. **A stored dependency record** (entry → dependents). Fast to query, but
   a second source of truth that can disagree with the records, must sync,
   and must itself be invalidated.
2. **Inside each derived record, read into memory when needed (chosen,
   D-13).** A Reflect answer already holds, in its own ciphertext, every
   entry that was sent for it and each entry's content hash then
   (`ReflectionAnswer.sources`). Nothing else is stored.

### What a Reflect session depends on

1. **Only the entries an answer cites** (D-14 as first written). Fewer
   removals. But an answer can paraphrase an entry it did not quote, so
   words from a deleted entry could live on in a reflection.
2. **Every entry that was sent for any answer in the session (chosen).**
   Nothing derived from changed or deleted words can remain. The cost is
   real: when the whole journal fits in a request, editing any entry
   removes every reflection made before the edit.

### How much is removed

1. One message, or a message and those after it. Leaves follow-ups resting
   on an answer that is gone, unless a tested subtree rule is built.
2. **The whole session (chosen; the PRD's conservative policy).**

## Comparison

| | Stored record | In the derived record |
| --- | --- | --- |
| Sources of truth | Two | One |
| Can drift between devices | Yes | No |
| Needs its own sync and invalidation | Yes | No |
| Cost to query | Low | A pass over derived records |

| | Cited entries only | Every entry sent |
| --- | --- | --- |
| Deleted words can survive as paraphrase | Yes | No |
| Reflections lost to a small edit | Few | Many |
| Matches "generated from previous content" (DEP-003) | Partly | Yes |

## Decision

**The rule.** A derived record is stale when an entry it was built from

- is known on this device to be deleted, or
- is here, is settled, and its content hash is not the one recorded.

Three things say nothing, and so remove nothing:

- An entry that is **not here and not known to be deleted**. Sync may not
  have fetched it yet. `RecordStore.deleted(kind)` exists so that "deleted"
  and "not here" are never confused.
- An entry **changed in two places and waiting for the person to choose**.
  The rule decides once they have chosen.
- An entry this version of the app **cannot read**.

The content hash covers the three answers and not feelings (D-24), so
changing only a feeling removes nothing.

**The engine** (`src/domain/deps/`). `findStale` reads; `invalidate`
deletes each stale record whole, with `RecordStore.delete`: an ordinary
tombstone that syncs like any other deletion. The rule is a function of
local state and nothing else, so running it twice does nothing, and two
devices that hold the same records reach the same result in any order
(SYNC-007). Two devices that both delete the same record meet without
bringing it back, because a tombstone is never written over.

```
entry edited or deleted                    (here, or brought by sync)
        │
        ▼
RecordStore changes ──► Invalidator.run ──► findStale ──► delete each
        ▲                                                     │
        └───────────── one more pass, finds nothing ◄─────────┘
                                                              │
                                              outbox ──► sync ──► other devices
```

**When it runs.** `Invalidator` is started by the app shell when the app
unlocks, runs once then, and again after every change to the records,
whether made on this device or applied from sync. It stops when the app
locks. One pass runs at a time. The `journal.changed` and
`journal.deleted` events are not what triggers it: an event can be missed,
and a change brought by sync announces none, so the store's own change
notice is used, which covers both.

**Rules, not special cases.** A kind of derived record takes part by
adding a rule to `src/domain/dependency-rules.ts` that reads its sources.
Cards drafted by AI have theirs there too (`CARD_RULE`): an unedited
AI card depends on every entry that was sent to draft it, and is deleted
when one of them changes. The engine imports nothing from
`src/ai`, the network or sync, and a test checks that.

**Telling the person.** Before: the edit screen and the delete
confirmation say how many reflections were built from the entry and that
they will be removed. After: a notice in the app shell says that a
reflection was removed and why. Both are a count and fixed words, never
which reflection or what it said.

**Nothing is regenerated.** No AI call is made, by this module or because
of it.

## Consequences

- No reflection can outlive the words it was written from, on any device.
- Editing an entry can remove many reflections. The person is told before
  and after. If this proves too costly in use, the alternative is a new
  decision, not a quiet change to the rule.
- A device that holds an older copy of an entry than the one a reflection
  was built from will remove that reflection. With an ordered change feed
  this happens only when the device's own unsent edit was refused, and
  then the entry is in conflict and the rule waits.
- A pass reads every derived record and lists the store's tombstones. That
  is fine at this scale; an index kept in memory is the next step if it is
  not.
- Real provider adapters (ADR-0007) may be connected now that this exists.
