<!-- E03-I06 | title: feat(journal): permanently delete an entry with confirmation and a local tombstone -->

## Role

You are a senior TypeScript engineer working in this repo's `src/` PWA (Preact, IndexedDB, Vitest with fake-indexeddb).

## Goal

Let a user permanently delete an entry or draft after explicit confirmation, online or offline, leaving a durable local tombstone and a queued delete operation, with no trash.

## Context

- **Parent epic:** #EPIC_03_NUMBER (Offline journal)
- **Predecessor issue(s):** #E03_I05_NUMBER (E03-I05: feat(journal): show the chronological timeline and edit saved entries in place). Each must be merged first.
- **SPEC section:** `docs/plans/relationship_communication_agent_prd.md` §3.2 [JR-007], §9 [OPS-003]
- **Acceptance criteria advanced:** AC-17
- **Files involved:**
  - `src/domain/journal/delete.ts`: new delete operation
  - `src/storage/encrypted-record-store.ts`: tombstone handling
  - `src/ui/screens/journal/entry.tsx`: delete action using `ConfirmDialog`
- **Prior decisions** (full register in `git-issues/2026-11-24_SPEC_summary.md`):
  - Delete replaces the stored envelope with a tombstone that keeps only the record ID, type and revision metadata. The ciphertext is removed from IndexedDB in the same transaction that queues the outbox delete.
  - There is no in-app trash and no undo (JR-007).
  - The confirmation copy is accurate: the entry is removed from this device now and from the user's other devices when they sync; encrypted copies inside rolling infrastructure backups expire within 30 days (OPS-003).
  - Delete emits `journal.deleted` on the domain event bus for the future invalidation engine.
- **State of the world:** Entries can be created and edited but not removed.

## Output Format

Deliverable is a single PR containing:

- [ ] Delete flow with confirmation, focus management and a non-blaming success message
- [ ] Tests: ciphertext is gone from IndexedDB; the tombstone survives reload; the timeline and search never show a tombstoned record
- [ ] E2E offline: delete, reload, the entry stays gone and one delete operation is queued
- [ ] Tests written first (TDD), named after the behaviour and citing the PRD IDs above
- [ ] Docstrings / TSDoc for every new public symbol
- [ ] No drive-by changes unrelated to the goal

## Examples

**Test that should pass after this issue lands**
```ts
it("leaves a tombstone and no ciphertext after delete (JR-007)", async () => {
  await deleteEntry(store, id);
  const raw = await rawRecord(id);
  expect(raw).toMatchObject({ tombstone: true });
  expect(raw.payload).toBeUndefined();
});
```

## Constraints

**Scope fence:** No bulk delete, no account deletion, no server call. Cascading to AI-derived records is E06-I05. If you find yourself touching files well
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
- [ ] `./scripts/e2e.sh` passes on desktop Chromium and mobile Safari, including axe checks for every screen this PR touches.
- [ ] `pre-commit run --all-files` is clean: no skipped hooks, no bypassed checks.
- [ ] Public API changes are reflected in docstrings and user-facing docs.
- [ ] PR body includes `Refs #EPIC_03_NUMBER` and `Closes` this issue's number.
- [ ] CI is green and the Claude reviewer's latest `Verdict:` on HEAD is `LGTM`.

## Labels

`spec-decomposition`, `core`, `journal`
