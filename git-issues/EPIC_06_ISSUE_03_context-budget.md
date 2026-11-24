<!-- E06-I03 | title: feat(reflect): select journal context deterministically within the token budget -->

## Role

You are a senior TypeScript engineer working in this repo's `src/` PWA on the Reflect feature and its AI integration.

## Goal

Given a question and the full journal, choose which entries to send so that the request fits a safe token budget, the choice is identical for identical inputs, older history keeps some representation, and the result reports exactly what was included and omitted.

## Context

- **Parent epic:** #EPIC_06_NUMBER (Reflect: source-linked answers about your own history)
- **Predecessor issue(s):** #E06_I02_NUMBER (E06-I02: feat(reflect): persist sessions with resume, Finish Reflection and delete). Each must be merged first.
- **SPEC section:** `docs/plans/relationship_communication_agent_prd.md` §3.3 [RF-004], §13.5, §6.4 [AI-016]
- **Acceptance criteria advanced:** AC-09
- **Files involved:**
  - `docs/adr/0009-reflect-context-selection.md`: new ADR
  - `src/domain/reflect/context.ts`: new pure selection function
  - `src/ai/budget.ts`: reservations for policy, session history, question, output and estimation error
  - `tests/frontend/reflect/context.test.ts`: new
- **Prior decisions** (full register in `git-issues/2026-11-24_SPEC_summary.md`):
  - D-18 algorithm. First reserve tokens for the policy prompt, the current session's exchanges, the question, the maximum output and a 15% estimation margin. If everything fits, send everything in chronological order. Otherwise fill the remaining budget in three passes: 60% newest entries first; 20% entries scored by lexical overlap with the question (reusing the local search tokenizer); 20% an evenly spaced sample across the older remainder. Present the selection chronologically.
  - The function is pure: same entries, question, session and config give the same selection. Ties break on record ID. No randomness, no clock.
  - It returns `coverage: { includedEntryIds, omittedEntryCount, truncated }`. When `truncated` is true the disclosure dialog and the answer header say so, and the prompt instructs the model that it has not seen everything.
  - An entry is included whole or not at all in the MVP; a single entry larger than the budget produces a clear error naming it.
  - Token estimates come from the adapter's `estimateTokens`, which is deliberately conservative.
- **State of the world:** The ask flow sends a fixed handful of entries regardless of size.

## Output Format

Deliverable is a single PR containing:

- [ ] ADR-0009 and the selection function
- [ ] Tests: fits-entirely case; truncation honours the budget for 5,000 synthetic entries; determinism across 100 runs; older coverage is non-empty when history is long; oversized single entry
- [ ] Property test: the estimated size of the selection never exceeds the budget
- [ ] Disclosure dialog shows 'N of M entries will be sent'
- [ ] Tests written first (TDD), named after the behaviour and citing the PRD IDs above
- [ ] Docstrings / TSDoc for every new public symbol
- [ ] No drive-by changes unrelated to the goal

## Examples

**Test that should pass after this issue lands**
```ts
it("truncates deterministically and reports omitted coverage (AC-09)", () => {
  const journal = syntheticEntries(5000);
  const a = selectContext(journal, "how have we handled chores?", session, config);
  const b = selectContext(journal, "how have we handled chores?", session, config);
  expect(a).toEqual(b);
  expect(a.coverage.truncated).toBe(true);
  expect(a.coverage.omittedEntryCount).toBe(5000 - a.coverage.includedEntryIds.length);
  expect(estimate(a)).toBeLessThanOrEqual(config.inputBudget);
});
```

## Constraints

**Scope fence:** No embeddings, vector search, summarisation of old entries or recency weighting model (PRD §2.2). If you find yourself touching files well
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
- [ ] `pre-commit run --all-files` is clean: no skipped hooks, no bypassed checks.
- [ ] Public API changes are reflected in docstrings and user-facing docs.
- [ ] PR body includes `Refs #EPIC_06_NUMBER` and `Closes` this issue's number.
- [ ] CI is green and the Claude reviewer's latest `Verdict:` on HEAD is `LGTM`.

## Labels

`spec-decomposition`, `core`, `reflect`
