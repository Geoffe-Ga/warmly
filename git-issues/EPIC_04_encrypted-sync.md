<!-- EPIC_04 | title: epic: Encrypted multi-device sync -->

## Epic Summary

Synchronise ciphertext between one user's authorised devices without ever using last-write-wins: atomic server revisions, compare-and-swap uploads, both conflicting ciphertexts kept until the user resolves them locally, and durable tombstones that stale devices cannot undo. Covers PRD §12 step 4 and §5.2 [SYNC-002..011].

## Scope

**In scope:**
- Client sync engine, status indicator and ADR-0006 (sync protocol)
- Server persistence: records, per-owner change feed, idempotent compare-and-swap operations
- Manual conflict review and resolution
- Deletion semantics, tombstones and the deletion ledger
- Isolation, ciphertext-only and rate-limit hardening
- Schema-version negotiation and safe app updates

**Out of scope:**
- Backup restore drills and the 30-day backup window (epic 08)
- AI-derived record cascades (epic 06); this epic only guarantees that deletes converge
- Any server-side reading of payloads

## Success Criteria

The epic is done when:

- [ ] An entry written on device A appears on device B, and the server database holds only ciphertext (AC-04)
- [ ] Two offline edits of one entry surface as a conflict with both versions; the user picks or merges (AC-16)
- [ ] A stale device cannot bring back a deleted record (AC-17)
- [ ] Owner B cannot read, change or detect owner A's records, conflicts or tombstones (AC-05)
- [ ] All child issues are closed
- [ ] `./scripts/check-all.sh` and `./scripts/e2e.sh` pass on `main`

## Child Issues

Work them in this order. Each child lists its own predecessors.

- [ ] #E04_I01_NUMBER — Skeleton: feat(sync): wire the client sync engine and status indicator against the stub API
- [ ] #E04_I02_NUMBER — Core: feat(sync): persist operations with atomic revisions, compare-and-swap and idempotency
- [ ] #E04_I03_NUMBER — Core: feat(sync): serve the owner-scoped change feed with a stable cursor
- [ ] #E04_I04_NUMBER — Core: feat(sync): drain the outbox and apply remote changes reliably on the client
- [ ] #E04_I05_NUMBER — Core: feat(sync): keep both conflicting versions and let the user resolve them locally
- [ ] #E04_I06_NUMBER — Core: feat(sync): make deletion durable so stale devices cannot resurrect records
- [ ] #E04_I07_NUMBER — Edges: test(sync): prove cross-account isolation and ciphertext-only handling, and add rate limits
- [ ] #E04_I08_NUMBER — Edges: feat(sync): negotiate schema versions and update the app without losing work

## Sequencing Notes

**Blocked by:** epic 02 (JWT, device proof) and epic 03 (encrypted store, outbox). **Blocks:** epic 05's credential sync and epic 08's restore drill. **Parallel-safe:** epic 05 I01, I02 and I04 can start while this epic is in flight.

## SPEC Reference

`docs/plans/relationship_communication_agent_prd.md` §12 step 4, §5.2 [SYNC-002..011], §7 (SyncEnvelope), §8. Design decisions made during decomposition are
recorded in `git-issues/2026-11-24_SPEC_summary.md`.

## Labels

`epic`, `spec-decomposition`, `sync`
