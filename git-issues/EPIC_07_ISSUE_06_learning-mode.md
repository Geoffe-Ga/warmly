<!-- E07-I06 | title: feat(cards): add learning mode with segment provenance and technique explanations -->

## Role

You are a senior TypeScript engineer working in this repo's `src/` PWA on the conversation-cards feature.

## Goal

Show AI-generated cards in two modes: a clean conversation mode, and a learning mode in which each segment is a focusable highlight that reveals the user's own supporting words or an explicit 'inferred' or 'suggested' label, plus why that wording may help.

## Context

- **Parent epic:** #EPIC_07_NUMBER (Prepare for a Conversation: collections and cards)
- **Predecessor issue(s):** #E07_I05_NUMBER (E07-I05: feat(cards): generate one to three thematic cards from explicitly selected entries). Each must be merged first.
- **SPEC section:** `docs/plans/relationship_communication_agent_prd.md` §3.4 [CC-004, CC-005, CC-006]
- **Acceptance criteria advanced:** AC-11, AC-26, AC-23
- **Files involved:**
  - `src/ui/screens/prepare/card.tsx`: mode switch
  - `src/ui/components/SegmentHighlight.tsx`, `SegmentDetail.tsx`: new
  - `src/domain/cards/provenance.ts`: new local excerpt resolution
- **Prior decisions** (full register in `git-issues/2026-11-24_SPEC_summary.md`):
  - Segments are real buttons with a visible category label, not colour alone. They open a detail panel with keyboard and touch, and focus returns to the segment on close.
  - The panel shows: (a) the supporting original text, resolved locally from the reference at display time, or the plain statement 'This is inferred from your writing' or 'This is a suggested addition' when `evidenceKind` is `inference` or `suggestion`; (b) the technique explanation; (c) a 'Generate more options' button, inert until E07-I07.
  - If a reference can no longer be resolved, show no excerpt rather than stale text.
  - Include the PRD's caveat in the teaching copy: an I-statement describes your experience; it does not make a factual claim unchallengeable (CC-005).
  - Conversation mode shows only the card text, with no highlights or annotations (CC-006).
- **State of the world:** Generated cards are saved with segments and provenance but display as plain text.

## Output Format

Deliverable is a single PR containing:

- [ ] Mode switch, highlight and detail components
- [ ] Tests for each `evidenceKind`, an unresolved reference and the conversation-mode view
- [ ] Axe run on the card screen in both modes with a panel open
- [ ] E2E: open each segment by keyboard and read its provenance
- [ ] Tests written first (TDD), named after the behaviour and citing the PRD IDs above
- [ ] Docstrings / TSDoc for every new public symbol
- [ ] No drive-by changes unrelated to the goal

## Examples

**Test that should pass after this issue lands**
```ts
it("labels an inferred segment instead of showing a source (AC-11)", async () => {
  await user.click(screen.getByRole("button", { name: /need: i need more notice/i }));
  expect(screen.getByText(/inferred from your writing/i)).toBeVisible();
  expect(screen.queryByTestId("source-excerpt")).toBeNull();
});
```

## Constraints

**Scope fence:** No AI call from this issue. No grammar or tone checker. If you find yourself touching files well
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
