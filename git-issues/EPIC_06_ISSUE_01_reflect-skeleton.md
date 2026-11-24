<!-- E06-I01 | title: feat(reflect): wire the Reflect landing and session screens to the fake provider -->

## Role

You are a senior TypeScript engineer working in this repo's `src/` PWA on the Reflect feature and its AI integration.

## Goal

Make Reflect navigable end to end with the fake provider and in-memory sessions: a landing page with timeline, search, saved sessions and an explicit 'Ask a question' control, and a session screen that shows a canned cited answer after the disclosure is confirmed.

## Context

- **Parent epic:** #EPIC_06_NUMBER (Reflect: source-linked answers about your own history)
- **Predecessor issue(s):** #E05_I07_NUMBER (E05-I07: feat(ai): handle failure, cancellation and cost limits with explicit Retry only). Each must be merged first.
- **SPEC section:** `docs/plans/relationship_communication_agent_prd.md` §3.3 [RF-001, RF-002, RF-003]
- **Acceptance criteria advanced:** AC-03, AC-23
- **Files involved:**
  - `src/domain/reflect/types.ts`: new `ReflectSession` and `ReflectMessage` types
  - `src/ui/screens/reflect/landing.tsx`, `session.tsx`: real screens replacing placeholders
  - `src/ui/components/CitedAnswer.tsx`: new prose renderer with citation links
  - `e2e/reflect.spec.ts`: new
- **Prior decisions** (full register in `git-issues/2026-11-24_SPEC_summary.md`):
  - Opening the landing page or a saved session makes no AI call. The only trigger is submitting a question and confirming the disclosure (RF-001, RF-003).
  - The user types their own question in a free-text field. There are no suggested or canned questions (RF-002).
  - The landing page reuses the journal timeline and search components rather than duplicating them.
  - Answers render as ordinary prose with inline numbered citations, not as an evidence table (RF-005).
- **State of the world:** Reflect routes are placeholders. The gateway, fake provider, contracts and request controller exist.

## Output Format

Deliverable is a single PR containing:

- [ ] Types and both screens wired to the gateway with the fake provider
- [ ] `CitedAnswer` with keyboard-reachable citations that link to the entry route
- [ ] E2E: landing makes zero AI requests; ask, confirm, see an answer; a citation opens the entry; axe on both screens
- [ ] Tests written first (TDD), named after the behaviour and citing the PRD IDs above
- [ ] Docstrings / TSDoc for every new public symbol
- [ ] No drive-by changes unrelated to the goal

## Examples

**Test that should pass after this issue lands**
```ts
it("opening Reflect and a saved session calls no provider (RF-001, AC-03)", async () => {
  render(<ReflectLanding />);
  await user.click(screen.getByRole("link", { name: /session from/i }));
  expect(fakeProvider.calls).toHaveLength(0);
});
```

## Constraints

**Scope fence:** Sessions live in memory only; persistence is E06-I02. Send a fixed small context; selection is E06-I03. If you find yourself touching files well
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
- [ ] PR body includes `Refs #EPIC_06_NUMBER` and `Closes` this issue's number.
- [ ] CI is green and the Claude reviewer's latest `Verdict:` on HEAD is `LGTM`.

## Labels

`spec-decomposition`, `tracer-skeleton`, `reflect`
