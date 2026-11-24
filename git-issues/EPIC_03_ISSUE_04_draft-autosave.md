<!-- E03-I04 | title: feat(journal): autosave drafts offline and keep them across close, reopen and lock -->

## Role

You are a senior TypeScript engineer working in this repo's `src/` PWA (Preact, IndexedDB, Vitest with fake-indexeddb).

## Goal

Save an in-progress entry automatically as an encrypted draft so that it is still there after going offline, closing the app, reopening it, or being locked by the inactivity timer.

## Context

- **Parent epic:** #EPIC_03_NUMBER (Offline journal)
- **Predecessor issue(s):** #E03_I03_NUMBER (E03-I03: feat(journal): complete an entry with three required answers and an optional feelings check-in). Each must be merged first.
- **SPEC section:** `docs/plans/relationship_communication_agent_prd.md` §3.2 [JR-004], §4.3 [DEV-005]
- **Acceptance criteria advanced:** AC-02, AC-21, AC-03
- **Files involved:**
  - `src/domain/journal/drafts.ts`: new autosave controller
  - `src/ui/screens/journal/compose.tsx`: resume and save-state indicator
  - `src/app/session.ts`: register the draft flush as a pre-lock hook
  - `e2e/journal-drafts.spec.ts`: new
- **Prior decisions** (full register in `git-issues/2026-11-24_SPEC_summary.md`):
  - A draft is a `JournalEntry` with `status: 'draft'`, encrypted like any other record. It is not a completed entry and is shown separately in the timeline.
  - Autosave is debounced and also fires on `visibilitychange` to hidden and on `pagehide`. It never calls AI (JR-004).
  - The pre-lock flush hook from E02-I05 awaits the pending save before keys are dropped. After unlock the user returns to the same draft.
  - A blank form creates no draft. An explicit 'Discard draft' asks for confirmation.
- **State of the world:** Entries are stored only when completed. Navigating away loses typed text.

## Output Format

Deliverable is a single PR containing:

- [ ] Autosave controller with fake-timer tests for debounce, hide and unload paths
- [ ] A visible, screen-reader-announced save state ('Saved on this device')
- [ ] E2E offline: type, close the page, reopen, unlock, the text is restored
- [ ] E2E: inactivity lock mid-edit, unlock, the text is restored
- [ ] Tests written first (TDD), named after the behaviour and citing the PRD IDs above
- [ ] Docstrings / TSDoc for every new public symbol
- [ ] No drive-by changes unrelated to the goal

## Examples

**Test that should pass after this issue lands**
```ts
it("flushes the draft before the session drops its keys (AC-21)", async () => {
  typeInto("good", "half a thought");
  await session.lock();
  await session.unlock(secret);
  expect((await store.list("journal")).find(isDraft)?.responses.good).toBe("half a thought");
});
```

## Constraints

**Scope fence:** One active draft per new-entry session; no multi-draft manager. No revision history. If you find yourself touching files well
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
