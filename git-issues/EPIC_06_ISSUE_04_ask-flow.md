<!-- E06-I04 | title: feat(reflect): answer questions with grounded, cited prose and session-only follow-ups -->

## Role

You are a senior TypeScript engineer working in this repo's `src/` PWA on the Reflect feature and its AI integration.

## Goal

Complete the real ask flow: build the Reflect prompt from the policy, the selected entries and the current session only, send it through the gateway after disclosure, validate grounding, and show prose whose citations open the exact source passage.

## Context

- **Parent epic:** #EPIC_06_NUMBER (Reflect: source-linked answers about your own history)
- **Predecessor issue(s):** #E06_I03_NUMBER (E06-I03: feat(reflect): select journal context deterministically within the token budget). Each must be merged first.
- **SPEC section:** `docs/plans/relationship_communication_agent_prd.md` §3.3 [RF-003, RF-005, RF-006, RF-012], §6.3 [AI-013]
- **Acceptance criteria advanced:** AC-07, AC-08, AC-26
- **Files involved:**
  - `src/ai/prompts/reflect.ts`: new prompt builder and policy text
  - `src/domain/reflect/ask.ts`: new orchestration: select, disclose, call, ground, store
  - `src/ui/components/CitedAnswer.tsx`: highlight the cited range in the entry view
  - `tests/frontend/reflect/prompt.test.ts`: golden tests of the built prompt
- **Prior decisions** (full register in `git-issues/2026-11-24_SPEC_summary.md`):
  - Journal text is passed as delimited evidence blocks labelled with aliases, with an explicit instruction that their content is data to analyse and never instructions to follow (SEC-010).
  - Policy text encodes AI-013: ground claims in the writing; present inferences as hypotheses; note uncertainty and contradictions; notice improvement as well as persistent concerns; no diagnosis, ratings, mind-reading or verdict on who is right; no pressure to stay or reconcile; never minimise harmful behaviour; say when evidence is insufficient; not medical advice.
  - Conversation memory is the current session's messages only (RF-006). A golden test proves a new session's prompt contains nothing from any other session.
  - A response that fails grounding is discarded, the session is left exactly as it was, and the user sees the `invalid_output` error with Retry.
  - A citation link opens the entry with the cited range highlighted, resolved locally from the stored reference. If the entry's hash no longer matches, the session should already be gone (E06-I05); render nothing stale.
- **State of the world:** Sessions persist, context selection exists, and the fake provider returns canned answers.

## Output Format

Deliverable is a single PR containing:

- [ ] Prompt builder with golden tests for a first question, a follow-up and a truncated context
- [ ] Orchestration with tests for success, grounding failure and each error kind leaving the session unchanged
- [ ] Citation highlight in the entry view, announced to screen readers
- [ ] E2E with the fake provider: ask, follow up, open a citation, the right passage is highlighted
- [ ] Tests written first (TDD), named after the behaviour and citing the PRD IDs above
- [ ] Docstrings / TSDoc for every new public symbol
- [ ] No drive-by changes unrelated to the goal

## Examples

**Test that should pass after this issue lands**
```ts
it("a new session's prompt contains no earlier AI conversation (RF-006, AC-08)", async () => {
  await askIn(sessionA, "first question", { answer: "UNIQUE-MARKER-A" });
  const prompt = await buildPromptFor(newSession(), "second question");
  expect(JSON.stringify(prompt)).not.toContain("UNIQUE-MARKER-A");
});
```

## Constraints

**Scope fence:** No streaming UI, no regenerate-with-different-tone, no AI call on session open or finish. Do not soften grounding to rescue a response. If you find yourself touching files well
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

`spec-decomposition`, `core`, `reflect`
