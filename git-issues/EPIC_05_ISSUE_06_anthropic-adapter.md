<!-- E05-I06 | title: feat(ai): implement the Anthropic adapter behind the gateway -->

## Role

You are a senior TypeScript engineer working in this repo's `src/ai/` module, experienced with LLM APIs and structured output.

## Goal

Implement `AIProvider` for Anthropic using the method ADR-0007 approved, passing the same conformance suite as the OpenAI adapter so both produce semantically equivalent app-level results.

## Context

- **Parent epic:** #EPIC_05_NUMBER (AI provider layer and the BYOK compatibility gate)
- **Predecessor issue(s):** #E05_I05_NUMBER (E05-I05: feat(ai): implement the OpenAI adapter behind the gateway). Each must be merged first.
- **SPEC section:** `docs/plans/relationship_communication_agent_prd.md` §6.1 [AI-001..006], §6.4 [AI-018]
- **Acceptance criteria advanced:** AC-15
- **Files involved:**
  - `src/ai/adapters/anthropic.ts`: new adapter
  - `tests/frontend/ai/conformance.ts`: register the adapter
  - `tests/frontend/ai/fixtures/anthropic/`: recorded response shapes with synthetic content
  - `index.html / CSP config`: add the provider host to `connect-src`
- **Prior decisions** (full register in `git-issues/2026-11-24_SPEC_summary.md`):
  - Follow ADR-0007 exactly, including the provider's documented explicit opt-in for direct browser access. If it recorded a block for this provider, stop.
  - Equivalence means the same inputs produce outputs that satisfy the same contracts and grounding rules, not identical wording.
  - Tests mock `fetch`; the real-provider smoke test is manual dispatch only, as for OpenAI.
  - The gateway chooses the adapter from the user's saved provider and never switches providers on failure.
- **State of the world:** The OpenAI adapter and conformance suite exist.

## Output Format

Deliverable is a single PR containing:

- [ ] Adapter passing the full conformance suite
- [ ] The same error-mapping tests as the OpenAI adapter
- [ ] Test: with Anthropic selected and failing, zero requests reach the OpenAI host, and the reverse
- [ ] CSP updated and tested
- [ ] Tests written first (TDD), named after the behaviour and citing the PRD IDs above
- [ ] Docstrings / TSDoc for every new public symbol
- [ ] No drive-by changes unrelated to the goal

## Examples

**Test that should pass after this issue lands**
```ts
it("never falls back to another provider on failure (AI-014, AC-15)", async () => {
  selectProvider("anthropic");
  mockFetch({ "api.anthropic.com": status(500) });
  await expect(gateway.reflect(request, token)).rejects.toThrow(ProviderError);
  expect(requestsTo("api.openai.com")).toHaveLength(0);
});
```

## Constraints

**Scope fence:** Same as the OpenAI adapter: no streaming, tools, embeddings or SDK unless the ADR requires it. If you find yourself touching files well
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
- [ ] PR body includes `Refs #EPIC_05_NUMBER` and `Closes` this issue's number.
- [ ] CI is green and the Claude reviewer's latest `Verdict:` on HEAD is `LGTM`.

## Labels

`spec-decomposition`, `core`, `ai`
