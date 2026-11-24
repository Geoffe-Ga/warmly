<!-- E05-I07 | title: feat(ai): handle failure, cancellation and cost limits with explicit Retry only -->

## Role

You are a senior TypeScript engineer working in this repo's `src/ai/` module, experienced with LLM APIs and structured output.

## Goal

Give every AI operation one shared, tested behaviour for failure, cancellation and cost: user state is preserved, a clear error offers an explicit Retry, budgets cap what is sent and returned, and nothing is retried or rerouted automatically.

## Context

- **Parent epic:** #EPIC_05_NUMBER (AI provider layer and the BYOK compatibility gate)
- **Predecessor issue(s):** #E05_I06_NUMBER (E05-I06: feat(ai): implement the Anthropic adapter behind the gateway). Each must be merged first.
- **SPEC section:** `docs/plans/relationship_communication_agent_prd.md` §6.4 [AI-014, AI-016, AI-017]
- **Acceptance criteria advanced:** AC-15, AC-03
- **Files involved:**
  - `src/ai/errors.ts`: new typed error taxonomy
  - `src/ai/request-controller.ts`: new operation state machine: idle, awaiting-consent, running, failed, done
  - `src/ai/budget.ts`: new input and output budget enforcement
  - `src/ui/components/AiRequestStatus.tsx`: new progress, Cancel and error-with-Retry UI
- **Prior decisions** (full register in `git-issues/2026-11-24_SPEC_summary.md`):
  - Error kinds: `no_credential`, `invalid_credential`, `rate_limited`, `timeout`, `network`, `provider_error`, `invalid_output`, `cancelled`. Each has user-facing copy that says what happened, why, and what to do next.
  - Retry is a button. Pressing it reopens the disclosure dialog and mints a new consent token. There is no timer, backoff loop or silent second attempt anywhere (AI-014).
  - The controller holds the user's inputs (question, selected entries) for the whole operation, so a failure loses nothing.
  - Budgets come from `src/ai/config.ts`: maximum input tokens, maximum output tokens and a request timeout. The dialog warns when a request is large. One AI request runs at a time.
  - Cancel aborts the in-flight `fetch` with `AbortController`. A cancelled request shows no error banner.
- **State of the world:** Adapters throw mapped errors; each future caller would have to invent its own handling.

## Output Format

Deliverable is a single PR containing:

- [ ] Taxonomy, controller, budget module and status component
- [ ] Table-driven tests: for every error kind, inputs are intact, exactly one request was made and Retry requires new consent
- [ ] Fake-timer test proving no request is issued over 10 minutes after a failure without user action
- [ ] Copy reviewed against the `user-facing-error-messages` skill
- [ ] Tests written first (TDD), named after the behaviour and citing the PRD IDs above
- [ ] Docstrings / TSDoc for every new public symbol
- [ ] No drive-by changes unrelated to the goal

## Examples

**Test that should pass after this issue lands**
```ts
it.each(ERROR_KINDS)("after %s nothing is retried until the user asks (AC-15)", async (kind) => {
  provider.failNextWith(kind);
  await controller.run(request, await consent());
  vi.advanceTimersByTime(10 * 60_000);
  expect(provider.calls).toHaveLength(1);
  expect(controller.inputs).toEqual(request);
});
```

## Constraints

**Scope fence:** No usage analytics, cost tracking history or background jobs. Do not add an 'auto-retry' setting. If you find yourself touching files well
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
- [ ] PR body includes `Refs #EPIC_05_NUMBER` and `Closes` this issue's number.
- [ ] CI is green and the Claude reviewer's latest `Verdict:` on HEAD is `LGTM`.

## Labels

`spec-decomposition`, `edges`, `ai`
