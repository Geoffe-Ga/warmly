<!-- E07-I03 | title: feat(cards): present one card at a time with no tracking -->

## Role

You are a senior TypeScript engineer working in this repo's `src/` PWA on the conversation-cards feature.

## Goal

Provide a distraction-free presentation view that always opens at the first card, shows one card in large readable text with next and previous, and persists nothing about what was viewed.

## Context

- **Parent epic:** #EPIC_07_NUMBER (Prepare for a Conversation: collections and cards)
- **Predecessor issue(s):** #E07_I02_NUMBER (E07-I02: feat(cards): create, rename, reorder and delete collections and manual cards). Each must be merged first.
- **SPEC section:** `docs/plans/relationship_communication_agent_prd.md` §3.4 [CC-012]
- **Acceptance criteria advanced:** AC-14, AC-03
- **Files involved:**
  - `src/ui/screens/prepare/present.tsx`: real presentation view
  - `tests/frontend/cards/present.test.tsx`: new
  - `e2e/presentation.spec.ts`: new
- **Prior decisions** (full register in `git-issues/2026-11-24_SPEC_summary.md`):
  - The current card index is component state only. It is not written to the store, the URL, `sessionStorage`, history state or any log. Reopening always starts at card one (CC-012).
  - Nothing records which cards were shown, for how long, or whether the end was reached.
  - Leaving the view returns to the collection and starts no follow-up flow, prompt or AI call.
  - Conversation text only: no teaching annotations, source excerpts or chrome beyond next, previous, position ('2 of 5') and close.
  - Large type that scales with text zoom, works one-handed on a phone, supports arrow keys, and respects reduced motion.
- **State of the world:** The presentation route shows a static placeholder card.

## Output Format

Deliverable is a single PR containing:

- [ ] Presentation view with keyboard and touch navigation
- [ ] Test that asserts the store, URL, Web Storage and history state are unchanged after paging through a collection
- [ ] E2E on both projects: advance to card three, close, reopen, card one is shown; zero network requests during presentation
- [ ] Tests written first (TDD), named after the behaviour and citing the PRD IDs above
- [ ] Docstrings / TSDoc for every new public symbol
- [ ] No drive-by changes unrelated to the goal

## Examples

**Test that should pass after this issue lands**
```ts
it("always reopens at card one and persists no progress (AC-14)", async () => {
  const before = await snapshotAllState();          // store + URL + storage + history
  await present(collection); await next(); await next(); await close();
  expect(await snapshotAllState()).toEqual(before);
  await present(collection);
  expect(screen.getByText("1 of 5")).toBeVisible();
});
```

## Constraints

**Scope fence:** No timers, progress bars, 'mark as discussed', notes field or post-conversation prompt. If you find yourself touching files well
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
