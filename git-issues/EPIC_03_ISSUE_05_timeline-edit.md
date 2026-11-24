<!-- E03-I05 | title: feat(journal): show the chronological timeline and edit saved entries in place -->

## Role

You are a senior TypeScript engineer working in this repo's `src/` PWA (Preact, IndexedDB, Vitest with fake-indexeddb).

## Goal

Show completed entries in a chronological timeline with their created date, open any entry, and edit it in place while preserving its creation date and keeping no history of the old text.

## Context

- **Parent epic:** #EPIC_03_NUMBER (Offline journal)
- **Predecessor issue(s):** #E03_I04_NUMBER (E03-I04: feat(journal): autosave drafts offline and keep them across close, reopen and lock). Each must be merged first.
- **SPEC section:** `docs/plans/relationship_communication_agent_prd.md` §3.2 [JR-005, JR-006]
- **Acceptance criteria advanced:** AC-06
- **Files involved:**
  - `src/ui/screens/journal/timeline.tsx`, `entry.tsx`: real list and view
  - `src/domain/journal/edit.ts`: new edit operation
  - `src/domain/events.ts`: new typed domain event bus
- **Prior decisions** (full register in `git-issues/2026-11-24_SPEC_summary.md`):
  - An edit overwrites the record: `createdAt` and `entryDate` are unchanged, `updatedAt` and `contentHash` are recomputed. The previous plaintext is not kept anywhere (JR-006).
  - Every completed-entry edit emits a `journal.changed` domain event with the entry ID and old and new hashes. Nothing subscribes yet; the invalidation engine in epic 06 will. Emit it only when the hash actually changes.
  - The timeline is newest first, groups drafts separately and renders from memory, so it works offline.
  - Editing is subject to the same three-answer validation as completion.
- **State of the world:** Timeline and entry screens show store data read-only.

## Output Format

Deliverable is a single PR containing:

- [ ] Timeline with an empty state and stable ordering for equal timestamps
- [ ] Edit flow with validation, plus a test that the old text is absent from memory store and IndexedDB after save
- [ ] Event bus with tests: emitted on a real change, not emitted when only feelings change
- [ ] E2E offline: edit an entry, reload, the edit persists and the created date is unchanged
- [ ] Tests written first (TDD), named after the behaviour and citing the PRD IDs above
- [ ] Docstrings / TSDoc for every new public symbol
- [ ] No drive-by changes unrelated to the goal

## Examples

**Test that should pass after this issue lands**
```ts
it("preserves createdAt and emits journal.changed on edit (JR-006)", async () => {
  const before = await store.get("journal", id);
  await editEntry(store, id, { good: "rewritten" });
  const after = await store.get("journal", id);
  expect(after.createdAt).toBe(before.createdAt);
  expect(events).toContainEqual({ type: "journal.changed", id, oldHash: before.contentHash, newHash: after.contentHash });
});
```

## Constraints

**Scope fence:** No pagination service, filters or calendar view. No undo. If you find yourself touching files well
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
