<!-- EPIC_03 | title: epic: Offline journal -->

## Epic Summary

Deliver the core product with no network and no AI: the three-question journal with an optional feelings check-in, drafts that survive closing the app, in-place edit, permanent delete, a chronological timeline and local search, all encrypted at rest in IndexedDB. Covers PRD §12 step 3, §3.2 [JR-001..010] and §5.1 [SYNC-001].

## Scope

**In scope:**
- Journal screens and the `RecordStore` seam
- Encrypted IndexedDB store, local migrations and the outbox of pending operations
- Compose with validation and feelings; draft autosave
- Timeline, entry view, in-place edit, permanent delete with local tombstone
- In-memory local search
- Storage-quota, suspend and offline-install edge cases

**Out of scope:**
- Sending the outbox to the server (epic 04)
- Any AI behaviour (epics 05 to 07)
- Revision history, trash, export or import (excluded from the MVP)

## Success Criteria

The epic is done when:

- [ ] With the network off, a user can write, save as draft, complete, edit, search and delete entries, and everything survives closing and reopening the app (AC-02, AC-06)
- [ ] IndexedDB contains no readable journal text
- [ ] No request to any AI host occurs anywhere in the journal (AC-03)
- [ ] All child issues are closed
- [ ] `./scripts/check-all.sh` and `./scripts/e2e.sh` pass on `main`

## Child Issues

Work them in this order. Each child lists its own predecessors.

- [ ] #E03_I01_NUMBER — Skeleton: feat(journal): wire compose, timeline, entry and search screens to an in-memory store
- [ ] #E03_I02_NUMBER — Core: feat(storage): persist records as ciphertext in IndexedDB with migrations and an outbox
- [ ] #E03_I03_NUMBER — Core: feat(journal): complete an entry with three required answers and an optional feelings check-in
- [ ] #E03_I04_NUMBER — Core: feat(journal): autosave drafts offline and keep them across close, reopen and lock
- [ ] #E03_I05_NUMBER — Core: feat(journal): show the chronological timeline and edit saved entries in place
- [ ] #E03_I06_NUMBER — Core: feat(journal): permanently delete an entry with confirmation and a local tombstone
- [ ] #E03_I07_NUMBER — Core: feat(journal): search entries locally, case-insensitively and offline
- [ ] #E03_I08_NUMBER — Edges: feat(journal): handle storage errors, suspend and resume, and the installed offline app

## Sequencing Notes

**Blocked by:** epic 02 (needs the root key, envelope and lock hooks). **Blocks:** epics 04, 06 and 07. I03 to I07 can overlap in pairs once I02 has merged, but merge in order.

## SPEC Reference

`docs/plans/relationship_communication_agent_prd.md` §12 step 3, §3.2 [JR-001..010], §5.1 [SYNC-001], §7 (JournalEntry). Design decisions made during decomposition are
recorded in `git-issues/2026-11-24_SPEC_summary.md`.

## Labels

`epic`, `spec-decomposition`, `journal`
