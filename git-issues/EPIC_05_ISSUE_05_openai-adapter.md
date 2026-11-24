<!-- E05-I05 | title: feat(ai): implement the OpenAI adapter behind the gateway -->

## Role

You are a senior TypeScript engineer working in this repo's `src/ai/` module, experienced with LLM APIs and structured output.

## Goal

Implement `AIProvider` for OpenAI using the method ADR-0007 approved, so that all three operations return contract-valid results in mocked integration tests and pass a shared adapter conformance suite.

## Context

- **Parent epic:** #EPIC_05_NUMBER (AI provider layer and the BYOK compatibility gate)
- **Predecessor issue(s):** #E05_I03_NUMBER (E05-I03: feat(ai): store provider credentials encrypted and sync them between the user's devices); #E05_I04_NUMBER (E05-I04: feat(ai): define the AI data contracts and the grounding validator). Each must be merged first.
- **SPEC section:** `docs/plans/relationship_communication_agent_prd.md` §6.1 [AI-001..006], §6.4 [AI-018]
- **Acceptance criteria advanced:** AC-15
- **Files involved:**
  - `src/ai/adapters/openai.ts`: new adapter
  - `tests/frontend/ai/conformance.ts`: new shared suite every adapter must pass
  - `tests/frontend/ai/fixtures/openai/`: recorded response shapes with synthetic content
  - `index.html / CSP config`: add the provider host to `connect-src`
- **Prior decisions** (full register in `git-issues/2026-11-24_SPEC_summary.md`):
  - Follow ADR-0007 exactly for transport, browser opt-in, default model and structured-output method. If it recorded a block for this provider, stop: this issue cannot proceed.
  - The adapter maps provider responses and errors to the app-level contracts and the typed error taxonomy. Provider-specific shapes do not leak past it.
  - `estimateTokens` is a conservative local estimate and makes no network call.
  - Tests mock `fetch`. No unit or CI test contacts the real API. A real-provider smoke test exists only as a manually dispatched workflow using the isolated test key.
  - The adapter itself never retries; one call in, one result or error out.
- **State of the world:** Only the fake provider implements the interface.

## Output Format

Deliverable is a single PR containing:

- [ ] Adapter and conformance suite (run against the fake as well)
- [ ] Mapping tests for: success, malformed JSON, schema violation, 401, 429, 5xx, network failure, abort
- [ ] Assertion that request bodies contain only the manifest content and policy text, and that the key appears only in the authorisation header
- [ ] CSP updated, with the CSP test from E01-I04 extended
- [ ] Tests written first (TDD), named after the behaviour and citing the PRD IDs above
- [ ] Docstrings / TSDoc for every new public symbol
- [ ] No drive-by changes unrelated to the goal

## Examples

**Test that should pass after this issue lands**
```ts
describe.each(ADAPTERS)("%s conforms to AIProvider", (name, make) => {
  it("returns a grounded ReflectionAnswer for a valid provider response", async () => {
    mockFetchWith(fixture(name, "reflect.ok"));
    const out = await make().reflect(request, { signal });
    expect(() => ground(out, request.manifest)).not.toThrow();
  });
});
```

## Constraints

**Scope fence:** No streaming, no tool use, no embeddings, no model picker. Do not add the vendor SDK unless ADR-0007 requires it. If you find yourself touching files well
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
