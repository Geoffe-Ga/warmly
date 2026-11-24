<!-- E07-I07 | title: feat(cards): generate alternative wordings for a segment on explicit request -->

## Role

You are a senior TypeScript engineer working in this repo's `src/` PWA on the conversation-cards feature.

## Goal

Make 'Generate more options' work: on an explicit request with its own disclosure, fetch alternative wordings for one segment, let the user pick one or dismiss them, and keep free rewriting available at all times.

## Context

- **Parent epic:** #EPIC_07_NUMBER (Prepare for a Conversation: collections and cards)
- **Predecessor issue(s):** #E07_I06_NUMBER (E07-I06: feat(cards): add learning mode with segment provenance and technique explanations). Each must be merged first.
- **SPEC section:** `docs/plans/relationship_communication_agent_prd.md` §3.4 [CC-005, CC-006], §6.1 [AI-001]
- **Acceptance criteria advanced:** AC-11, AC-15
- **Files involved:**
  - `src/ai/prompts/alternatives.ts`: new prompt builder
  - `src/domain/cards/alternatives.ts`: new orchestration
  - `src/ui/components/SegmentDetail.tsx`: options list
- **Prior decisions** (full register in `git-issues/2026-11-24_SPEC_summary.md`):
  - Each press of 'Generate more options' is a separate AI request with its own disclosure and consent token. Opening the panel never triggers it (CC-005).
  - The request sends the card's source entries (the same manifest rules) and the current segment. Alternatives are grounded like any segment.
  - Alternatives are transient: they are shown in the panel and not stored until the user chooses one.
  - Choosing an alternative is an edit of the card, so it follows the ownership rule in E07-I08. Until that issue lands, choosing replaces the segment text and its evidence with the alternative's.
  - The user can always type their own wording instead; the options list never blocks or replaces the edit field (CC-006).
- **State of the world:** The 'Generate more options' button is present and inert.

## Output Format

Deliverable is a single PR containing:

- [ ] Prompt builder with golden tests and the orchestration
- [ ] Tests: opening the panel makes no call; each press makes exactly one; a failure keeps the card unchanged and offers Retry; dismissed alternatives leave no trace in storage
- [ ] E2E with the fake provider: request options, pick one, the card text updates
- [ ] Tests written first (TDD), named after the behaviour and citing the PRD IDs above
- [ ] Docstrings / TSDoc for every new public symbol
- [ ] No drive-by changes unrelated to the goal

## Examples

**Test that should pass after this issue lands**
```ts
it("requests alternatives only on an explicit press (AC-11)", async () => {
  await user.click(segmentButton);                               // open panel
  expect(fakeProvider.calls).toHaveLength(0);
  await user.click(screen.getByRole("button", { name: /generate more options/i }));
  await confirmDisclosure();
  expect(fakeProvider.calls).toHaveLength(1);
});
```

## Constraints

**Scope fence:** No 'regenerate whole card', no tone presets, no automatic suggestion while typing. If you find yourself touching files well
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
