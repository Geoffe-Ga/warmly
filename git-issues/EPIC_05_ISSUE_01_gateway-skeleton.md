<!-- E05-I01 | title: feat(ai): wire the AIProvider interface, fake provider, gateway and consent dialog -->

## Role

You are a senior TypeScript engineer working in this repo's `src/ai/` module, experienced with LLM APIs and structured output.

## Goal

Create the AI seam end to end with no real provider: the `AIProvider` interface, a deterministic fake, a gateway that refuses to run without a per-request consent, the disclosure dialog, and a Settings screen showing the provider state.

## Context

- **Parent epic:** #EPIC_05_NUMBER (AI provider layer and the BYOK compatibility gate)
- **Predecessor issue(s):** #E02_I05_NUMBER (E02-I05: feat(security): add trusted-device unlock, manual lock and the 30-minute inactivity lock); #E01_I04_NUMBER (E01-I04: feat(security): add CSP, security headers, log redaction and the network egress guard). Each must be merged first.
- **SPEC section:** `docs/plans/relationship_communication_agent_prd.md` §6.1 [AI-001..006], §6.4 [AI-015], §4.2 [SEC-009]
- **Acceptance criteria advanced:** AC-03, AC-23
- **Files involved:**
  - `src/ai/provider.ts`: new interface: `reflect`, `generateCards`, `generateSegmentAlternatives`, `estimateTokens`, `capabilities`, `validateConfig`
  - `src/ai/fake-provider.ts`: new deterministic fake, the default in development
  - `src/ai/gateway.ts`: new single entry point for every AI call
  - `src/ui/components/AiDisclosureDialog.tsx`: new consent dialog
  - `src/ui/screens/settings/ai-provider.tsx`: provider status screen
  - `eslint.config.js`: restrict imports of provider modules to the gateway
- **Prior decisions** (full register in `git-issues/2026-11-24_SPEC_summary.md`):
  - D-17: `gateway.ts` is the only module allowed to invoke a provider. An ESLint restriction and a dependency test enforce it.
  - The gateway requires a `ConsentToken` created only by the disclosure dialog's confirm handler, bound to one request and consumed on use. No token, no call. This is how 'no automatic AI' is made structural.
  - The dialog shows, every time: the provider name, what is being sent (for example '14 journal entries, your question'), that it goes to a third party under that provider's terms, and that BYOK does not guarantee zero retention (AI-015).
  - The gateway makes exactly one attempt per token: no retry loop and no second provider, by construction.
- **State of the world:** No AI code exists. Settings is a placeholder.

## Output Format

Deliverable is a single PR containing:

- [ ] Interface, fake, gateway and dialog with tests
- [ ] Tests: a call without a token throws; a token cannot be reused; a token for request A cannot authorise request B
- [ ] Dependency test: no module other than the gateway imports a provider
- [ ] Settings screen showing 'No AI provider connected' with axe
- [ ] Tests written first (TDD), named after the behaviour and citing the PRD IDs above
- [ ] Docstrings / TSDoc for every new public symbol
- [ ] No drive-by changes unrelated to the goal

## Examples

**Test that should pass after this issue lands**
```ts
it("refuses to call a provider without a fresh consent token (SEC-009)", async () => {
  await expect(gateway.reflect(request, undefined as never)).rejects.toThrow(ConsentRequiredError);
  const token = await confirmDisclosure(request);
  await gateway.reflect(request, token);
  await expect(gateway.reflect(request, token)).rejects.toThrow(ConsentRequiredError);
});
```

## Constraints

**Scope fence:** No network code and no real provider. The fake must not be reachable in a production build. If you find yourself touching files well
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

`spec-decomposition`, `tracer-skeleton`, `ai`
