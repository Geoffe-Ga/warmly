<!-- E05-I02 | title: docs(ai): run the browser BYOK compatibility and security review and record ADR-0007 -->

## Role

You are a senior security engineer evaluating third-party AI APIs for direct use from a browser.

## Goal

Produce the provider-by-provider compatibility and security report the PRD requires, decide in ADR-0007 whether direct browser access is acceptable for each provider, choose the default model and structured-output method for each, and block release if the threat model cannot be met.

## Context

- **Parent epic:** #EPIC_05_NUMBER (AI provider layer and the BYOK compatibility gate)
- **Predecessor issue(s):** #E05_I01_NUMBER (E05-I01: feat(ai): wire the AIProvider interface, fake provider, gateway and consent dialog). Each must be merged first.
- **SPEC section:** `docs/plans/relationship_communication_agent_prd.md` §4.2 [SEC-008], §13.1, §13.8, §15, §6.1 [AI-003, AI-004]
- **Acceptance criteria advanced:** AC-15
- **Files involved:**
  - `docs/security/provider-compatibility-report.md`: new report
  - `docs/adr/0007-ai-provider-browser-access.md`: new ADR
  - `src/ai/config.ts`: new central config: provider hosts, default model IDs, context and output budgets
  - `spikes/ai-browser/`: throwaway spike pages, excluded from the build and from coverage
- **Prior decisions** (full register in `git-issues/2026-11-24_SPEC_summary.md`):
  - D-17: the intended design is direct `fetch` calls to each provider's REST API with no vendor SDK, to keep the dependency and CSP surface small. The spike confirms or refutes that this works.
  - For each provider the report covers: documented browser support and the explicit opt-in it requires, observed CORS behaviour, API-key scoping and spend-limit options, what a compromised page could do with the key, retention and training terms with links and the date checked, and the structured-output mechanism.
  - Read current provider documentation at implementation time. Do not rely on memory for model IDs, headers or limits; cite the page and date for each.
  - The app is never described as 'secure by default' for BYOK. The browser is not an enclave, and the report says so plainly.
  - If a provider cannot be used acceptably, the outcome is a documented release blocker and a proposed architecture revision (for example a user-managed proxy). A FastAPI plaintext proxy is not an option.
- **State of the world:** The gateway and fake exist. Nothing is known first-hand about either provider's browser behaviour.

## Output Format

Deliverable is a single PR containing:

- [ ] The report and ADR-0007 with an explicit accept or block decision per provider
- [ ] `src/ai/config.ts` with the chosen defaults and a test pinning them
- [ ] User-facing disclosure copy for each provider, with links to its terms
- [ ] A list of residual risks the user is accepting
- [ ] Tests written first (TDD), named after the behaviour and citing the PRD IDs above
- [ ] Docstrings / TSDoc for every new public symbol
- [ ] No drive-by changes unrelated to the goal

## Examples

**Report excerpt (shape, not content)**
```markdown
## Provider: <name>           checked: 2026-MM-DD
| Question                         | Finding | Evidence (URL) |
| Browser calls documented?        | …       | …              |
| Opt-in required                  | …       | …              |
| CORS preflight result            | …       | spike log      |
| Key scoping / spend limits       | …       | …              |
| Retention / training terms       | …       | …              |
| Structured output method         | …       | …              |
**Decision:** accept | block (reason, proposed revision)
```

## Constraints

**Scope fence:** Spike code stays in `spikes/`. Do not wire a real adapter here, and never commit a key. If you find yourself touching files well
outside the list above, stop and check with the user.

**Needs a human:** Supplying isolated, spend-capped test API keys for both providers and personally accepting or rejecting the residual risks in ADR-0007. An agent must not create accounts, enter payment details or handle live secrets. Do everything else, then stop and report exactly what the human must do.

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

`spec-decomposition`, `core`, `ai`, `needs-human`
