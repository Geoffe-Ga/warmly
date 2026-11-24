<!-- E08-I07 | title: feat(ui): complete the accessibility sweep and visual polish across every screen -->

## Role

You are a senior frontend engineer with accessibility expertise working in `src/ui/` and `e2e/`.

## Goal

Bring every screen and state to the WCAG 2.2 AA implementation target under automated checks, apply the warm visual identity consistently, and make the privacy status indicators complete and honest.

## Context

- **Parent epic:** #EPIC_08_NUMBER (Post-conversation reflection and release hardening)
- **Predecessor issue(s):** #E08_I06_NUMBER (E08-I06: test(pwa): harden install, offline, suspend and update behaviour on both supported browsers). Each must be merged first.
- **SPEC section:** `docs/plans/relationship_communication_agent_prd.md` §3.6 [UI-001..008], §11 AC-23
- **Acceptance criteria advanced:** AC-23
- **Files involved:**
  - `e2e/a11y.spec.ts`: new exhaustive axe sweep driven by the route table
  - `src/ui/`: fixes and polish
  - `src/ui/components/StatusBanner.tsx`, `SyncStatus.tsx`: status completeness
  - `docs/accessibility.md`: new statement of what is and is not verified
- **Prior decisions** (full register in `git-issues/2026-11-24_SPEC_summary.md`):
  - The sweep is generated from `src/app/routes.ts` and a registry of states (empty, loading, error, dialog open, locked, conflict, offline). A route or state without a sweep entry fails the suite.
  - Also checked automatically: 200% text zoom without loss of content, 320 CSS px width without horizontal scrolling, visible focus, target size, and `prefers-reduced-motion`.
  - Status indicators cover encryption, AI provider, offline, sync, recovery key, deletion and device revocation, and none reveals private text on a locked screen (UI-008).
  - The accessibility statement says: automated checks pass against a WCAG 2.2 AA target; manual screen-reader testing and formal certification are deferred and are not claimed (UI-006).
  - Light theme only.
- **State of the world:** Each feature ran axe on its own screens' default state. There is no exhaustive sweep and styling is uneven.

## Output Format

Deliverable is a single PR containing:

- [ ] Generated sweep on both browsers with zero violations
- [ ] Zoom, reflow, focus and reduced-motion checks
- [ ] Visual polish pass using tokens only (no hard-coded colours; add a lint check)
- [ ] Accessibility statement
- [ ] Tests written first (TDD), named after the behaviour and citing the PRD IDs above
- [ ] Docstrings / TSDoc for every new public symbol
- [ ] No drive-by changes unrelated to the goal

## Examples

**Test that should pass after this issue lands**
```ts
for (const { route, state } of SWEEP) {
  test(`axe: ${route.path} [${state.name}] (AC-23)`, async ({ page }) => {
    await state.arrange(page, route);
    const { violations } = await new AxeBuilder({ page }).withTags(WCAG_22_AA).analyze();
    expect(violations).toEqual([]);
  });
}
```

## Constraints

**Scope fence:** No new features, no dark theme, no disabling of axe rules. A rule may be excluded only with the documented escape hatch. If you find yourself touching files well
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
- [ ] PR body includes `Refs #EPIC_08_NUMBER` and `Closes` this issue's number.
- [ ] CI is green and the Claude reviewer's latest `Verdict:` on HEAD is `LGTM`.

## Labels

`spec-decomposition`, `polish`, `release`
