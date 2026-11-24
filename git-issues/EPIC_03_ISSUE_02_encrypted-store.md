<!-- E03-I02 | title: feat(storage): persist records as ciphertext in IndexedDB with migrations and an outbox -->

## Role

You are a senior TypeScript engineer working in this repo's `src/` PWA (Preact, IndexedDB, Vitest with fake-indexeddb).

## Goal

Replace `MemoryRecordStore` with an IndexedDB-backed store that holds only encrypted envelopes, decrypts into memory on unlock, clears on lock, records every mutation in an outbox, and has a tested migration path.

## Context

- **Parent epic:** #EPIC_03_NUMBER (Offline journal)
- **Predecessor issue(s):** #E03_I01_NUMBER (E03-I01: feat(journal): wire compose, timeline, entry and search screens to an in-memory store). Each must be merged first.
- **SPEC section:** `docs/plans/relationship_communication_agent_prd.md` §5.1 [SYNC-001], §4.2 [SEC-004], §7 (local migrations), §13.6
- **Acceptance criteria advanced:** AC-04, AC-02
- **Files involved:**
  - `src/storage/db.ts`: new schema, versioning and migrations
  - `src/storage/encrypted-record-store.ts`: new real `RecordStore`
  - `src/storage/outbox.ts`: new durable operation queue
  - `tests/frontend/storage/`: tests on fake-indexeddb
  - `tests/fixtures/idb/v1/`: committed database snapshot for migration tests
- **Prior decisions** (full register in `git-issues/2026-11-24_SPEC_summary.md`):
  - D-12: IndexedDB stores the same envelope format that will be synced, plus non-secret metadata: record ID, type, local revision, base server revision, tombstone flag, dirty flag. Plaintext exists only in memory while unlocked.
  - D-09: record IDs are random UUIDv4, so an ID reveals nothing about when the record was written.
  - Every `put` and `delete` writes the record and an outbox operation (with a fresh `op_id`) in **one** IndexedDB transaction, so the queue can never disagree with the data.
  - The store registers a lock hook with the session: on lock it drops all decrypted state.
  - Migrations are forward-only, idempotent and tested against committed snapshots of every previous schema version.
- **State of the world:** Screens run against `MemoryRecordStore`. Nothing survives a reload.

## Output Format

Deliverable is a single PR containing:

- [ ] Schema v1, the store and the outbox behind the existing interface
- [ ] Test that scans every IndexedDB value for a plaintext canary and finds none
- [ ] Tests: reload restores records after unlock; lock empties memory; a failed transaction leaves neither record nor outbox entry
- [ ] Migration harness with the v1 snapshot fixture
- [ ] Tests written first (TDD), named after the behaviour and citing the PRD IDs above
- [ ] Docstrings / TSDoc for every new public symbol
- [ ] No drive-by changes unrelated to the goal

## Examples

**Test that should pass after this issue lands**
```ts
it("writes no journal plaintext to IndexedDB (SYNC-001, AC-04)", async () => {
  await store.put(entry({ good: "CANARY-plaintext" }));
  expect(JSON.stringify(await dumpAllObjectStores())).not.toContain("CANARY-plaintext");
});
```

## Constraints

**Scope fence:** Do not send the outbox anywhere; epic 04 drains it. Do not persist any search index or decrypted cache. If you find yourself touching files well
outside the list above, stop and check with the user.

**Product invariants (CLAUDE.md, PRD §0 and §4–§6):** no plaintext leaves
the client except to the user's chosen AI provider after an explicit, disclosed
user action; no automatic AI calls, AI retries or provider fallback; owner-only
access with device authorization re-checked on every sync operation; no partner
linking, scores, streaks or tracking; sync never uses last-write-wins. If an
invariant cannot be met, stop and report a scoped blocker. Do not weaken it, and
do not delete or skip a failing test to get green.

**Anti-bypass (verbatim, non-negotiable):**

> No `noqa`, `# type: ignore`, `pylint: disable`, `eslint-disable`, or
> equivalent linter/type-checker silencers. Fix the root cause. The only
> exception is the documented 4-line escape hatch (third-party library
> bug / language-version compatibility / benchmarked performance
> necessity / generated code) — and it must include the reason, a
> reference URL, an alternative considered, and a review date. See the
> `max-quality-no-shortcuts` skill.

**Tracer-code invariant:** The system must remain demoable after this PR
merges. If your change breaks an unrelated screen, endpoint or test, you
have gone outside scope: revert and re-plan.

## Definition of Done (stay-green)

- [ ] `./scripts/check-all.sh` exits 0 (lint, format, types, security,
  complexity ≤10, unit tests with coverage ≥90% and branch ≥85%).
- [ ] `pre-commit run --all-files` is clean: no skipped hooks, no bypassed checks.
- [ ] Public API changes are reflected in docstrings and user-facing docs.
- [ ] PR body includes `Refs #EPIC_03_NUMBER` and `Closes` this issue's number.
- [ ] CI is green and the Claude reviewer's latest `Verdict:` on HEAD is `LGTM`.

## Labels

`spec-decomposition`, `core`, `journal`
