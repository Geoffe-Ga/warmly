<!-- E07-I02 | title: feat(cards): create, rename, reorder and delete collections and manual cards -->

## Role

You are a senior TypeScript engineer working in this repo's `src/` PWA on the conversation-cards feature.

## Goal

Let a user manage private named collections and write unlimited manual cards in them, with editing, reordering and confirmed deletion, stored encrypted, synced, and usable offline.

## Context

- **Parent epic:** #EPIC_07_NUMBER (Prepare for a Conversation: collections and cards)
- **Predecessor issue(s):** #E07_I01_NUMBER (E07-I01: feat(cards): wire collections, card editor, presentation and print screens to in-memory data). Each must be merged first.
- **SPEC section:** `docs/plans/relationship_communication_agent_prd.md` §3.4 [CC-001, CC-010, CC-011], §5.1 [SYNC-001]
- **Acceptance criteria advanced:** AC-13, AC-05
- **Files involved:**
  - `src/domain/cards/collections.ts`, `cards.ts`: new services
  - `src/storage/`: register the record types
  - `src/ui/screens/prepare/`: create, rename, reorder, delete UI
- **Prior decisions** (full register in `git-issues/2026-11-24_SPEC_summary.md`):
  - A collection and each card are separate encrypted records, so two devices editing different cards do not conflict.
  - Order lives in the collection's `cardIds`. Reordering is available by drag and by keyboard-operable 'Move up' and 'Move down' controls, with the new position announced.
  - Deleting a collection deletes its cards and requires `ConfirmDialog`; renaming does not.
  - Manual cards carry no AI attribution and creating or editing one makes no AI call (CC-010).
  - There is no limit on the number of cards in a collection; the limit of three applies only to one AI generation request (CC-011).
- **State of the world:** Screens show seeded in-memory data and cannot change it.

## Output Format

Deliverable is a single PR containing:

- [ ] Services with tests, including deleting a collection tombstoning every card
- [ ] Accessible reorder controls with tests
- [ ] Test: 200 manual cards in one collection remain usable
- [ ] E2E offline: create a collection and three cards, reorder, reload, state persists; two-device sync test
- [ ] Tests written first (TDD), named after the behaviour and citing the PRD IDs above
- [ ] Docstrings / TSDoc for every new public symbol
- [ ] No drive-by changes unrelated to the goal

## Examples

**Test that should pass after this issue lands**
```ts
it("moves a card with the keyboard and announces the new position (AC-13)", async () => {
  await user.click(within(card("Thank you for…")).getByRole("button", { name: /move down/i }));
  expect(cardTitles()).toEqual(["I'd like to ask…", "Thank you for…"]);
  expect(screen.getByRole("status")).toHaveTextContent(/moved to position 2 of 2/i);
});
```

## Constraints

**Scope fence:** No sharing, duplication across accounts, templates or AI. A drag-and-drop library is acceptable only if it is accessible, maintained and pinned. If you find yourself touching files well
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
- [ ] PR body includes `Refs #EPIC_07_NUMBER` and `Closes` this issue's number.
- [ ] CI is green and the Claude reviewer's latest `Verdict:` on HEAD is `LGTM`.

## Labels

`spec-decomposition`, `core`, `cards`
