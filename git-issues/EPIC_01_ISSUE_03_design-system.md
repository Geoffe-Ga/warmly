<!-- E01-I03 | title: feat(ui): add light-theme design tokens and the accessible component kit -->

## Role

You are a senior TypeScript engineer working in this repo's `src/` PWA (Vite, Vitest, Playwright).

## Goal

Provide the warm light-only visual identity as CSS design tokens and a small set of accessible components that every later screen composes, with contrast verified against WCAG 2.2 AA.

## Context

- **Parent epic:** #EPIC_01_NUMBER (Foundation and walking skeleton)
- **Predecessor issue(s):** #E01_I01_NUMBER (E01-I01: feat(shell): adopt Preact and wire every MVP route to a placeholder screen). Each must be merged first.
- **SPEC section:** `docs/plans/relationship_communication_agent_prd.md` §3.6 [UI-001..008]
- **Acceptance criteria advanced:** AC-23
- **Files involved:**
  - `src/styles.css`: existing global styles; becomes tokens plus base rules
  - `src/ui/components/`: new: Button, TextField, TextArea, ConfirmDialog, StatusBanner, Card, PageLayout
  - `tests/frontend/ui/`: component tests
  - `e2e/`: axe run over a `/dev/components` gallery route (development builds only)
- **Prior decisions** (full register in `git-issues/2026-11-24_SPEC_summary.md`):
  - Reference colours: coral `#E35D7A`, blush `#FDE4E8`, soft pink `#F7A7B5`, paper `#FFF7F8`, ink `#2E2A2B`. They are **not** guaranteed text colours. Derive darker variants wherever 4.5:1 (text) or 3:1 (UI) fails, and test the ratios.
  - Light theme only. Do not add `prefers-color-scheme: dark` styles.
  - Touch targets at least 44 by 44 CSS px; layout survives 200% text zoom; honour `prefers-reduced-motion`.
  - `ConfirmDialog` is the only way to confirm destructive actions; it traps focus and restores it on close.
- **State of the world:** Placeholder screens from E01-I01 use bare elements and minimal CSS.

## Output Format

Deliverable is a single PR containing:

- [ ] Token sheet (colour, type scale, spacing, radius) and the components listed above
- [ ] A unit test that computes the contrast ratio for every text/background token pair in use
- [ ] Keyboard tests: dialog focus trap, Escape to close, visible focus ring
- [ ] Placeholder screens restyled with the kit, with no new behaviour
- [ ] Tests written first (TDD), named after the behaviour and citing the PRD IDs above
- [ ] Docstrings / TSDoc for every new public symbol
- [ ] No drive-by changes unrelated to the goal

## Examples

**Test that should pass after this issue lands**
```ts
it.each(TEXT_PAIRS)("%s on %s meets 4.5:1 (UI-001, WCAG 2.2 AA)", (fg, bg) => {
  expect(contrastRatio(tokens[fg], tokens[bg])).toBeGreaterThanOrEqual(4.5);
});
```

## Constraints

**Scope fence:** No feature logic and no CSS framework dependency. Do not claim manual screen-reader verification anywhere; it is deferred (UI-006). If you find yourself touching files well
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
- [ ] PR body includes `Refs #EPIC_01_NUMBER` and `Closes` this issue's number.
- [ ] CI is green and the Claude reviewer's latest `Verdict:` on HEAD is `LGTM`.

## Labels

`spec-decomposition`, `core`, `foundation`
