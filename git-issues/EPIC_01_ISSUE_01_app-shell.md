<!-- E01-I01 | title: feat(shell): adopt Preact and wire every MVP route to a placeholder screen -->

## Role

You are a senior TypeScript engineer working in this repo's `src/` PWA (Vite, Vitest, Playwright).

## Goal

Record ADR-0001 (Preact) and replace the framework-free shell with a routed app in which Home shows exactly the three primary actions and every MVP screen exists as an accessible placeholder that passes axe.

## Context

- **Parent epic:** #EPIC_01_NUMBER (Foundation and walking skeleton)
- **Predecessor issue(s):** none. This is the first issue of the decomposition.
- **SPEC section:** `docs/plans/relationship_communication_agent_prd.md` §3.1 [UX-001], §3.6 [UI-003]
- **Acceptance criteria advanced:** AC-23
- **Files involved:**
  - `docs/adr/0001-ui-framework.md`: new ADR, plus `docs/adr/README.md` with the ADR template
  - `src/app.ts`, `src/main.ts`: current shell and bootstrap, to be replaced
  - `src/app/routes.ts`: new single route table (path, title, screen component)
  - `src/ui/screens/`: new placeholder screens, one per route
  - `tests/frontend/app.test.ts`, `e2e/home.spec.ts`: existing tests to migrate
- **Prior decisions** (full register in `git-issues/2026-11-24_SPEC_summary.md`):
  - D-01: UI framework is **Preact with TSX**. It keeps the React component model, has no transitive runtime dependencies (smaller supply-chain surface, SEC-001) and escapes text by default. Verify the latest stable version on the npm registry and pin it exactly.
  - Routes carry opaque record IDs only. Never put journal text, search queries or card text in a URL (SEC-007).
  - Secondary navigation holds Collections, Settings and Manage Devices. Home has no summaries, scores or AI calls.
- **State of the world:** `src/app.ts` renders a static `<main>` with three buttons that do nothing. No router or framework exists.

## Output Format

Deliverable is a single PR containing:

- [ ] ADR-0001 using the options/trade-offs format from the `architectural-decisions` skill
- [ ] Route table and placeholder screens for: Home, Journal (new, timeline, entry), Reflect (landing, session), Prepare (collections, collection, card, present, print), Settings, Manage Devices, Onboarding, Sign in, Locked
- [ ] Each placeholder has one `<h1>`, a landmark, a working back/home link and focus moved to the heading on navigation
- [ ] One parametrised Playwright test that visits every route and runs axe
- [ ] `CLAUDE.md` 'Open decisions' updated to point at ADR-0001
- [ ] Tests written first (TDD), named after the behaviour and citing the PRD IDs above
- [ ] Docstrings / TSDoc for every new public symbol
- [ ] No drive-by changes unrelated to the goal

## Examples

**Test that should pass after this issue lands**
```ts
it("Home shows exactly the three primary actions, in order (UX-001)", () => {
  render(<App />);
  const names = screen.getAllByRole("link", { name: /journal|reflect|prepare/i })
    .map((el) => el.textContent);
  expect(names).toEqual(["Journal", "Reflect", "Prepare for a Conversation"]);
});
```

## Constraints

**Scope fence:** Placeholders only. Do not add forms, storage, auth or styling beyond what axe needs; tokens and components are E01-I03. If you find yourself touching files well
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

`spec-decomposition`, `tracer-skeleton`, `foundation`
