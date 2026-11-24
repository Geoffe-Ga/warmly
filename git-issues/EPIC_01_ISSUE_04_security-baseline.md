<!-- E01-I04 | title: feat(security): add CSP, security headers, log redaction and the network egress guard -->

## Role

You are a senior security-minded full-stack engineer working across `src/`, `e2e/` and `warmly/`.

## Goal

Make three guarantees mechanical: the built app ships a strict Content Security Policy, backend logs cannot contain request bodies, and any test that sends a request to a host outside the allowlist fails.

## Context

- **Parent epic:** #EPIC_01_NUMBER (Foundation and walking skeleton)
- **Predecessor issue(s):** #E01_I01_NUMBER (E01-I01: feat(shell): adopt Preact and wire every MVP route to a placeholder screen); #E01_I02_NUMBER (E01-I02: feat(api): wire every /v1 route with typed stubs and a committed OpenAPI contract). Each must be merged first.
- **SPEC section:** `docs/plans/relationship_communication_agent_prd.md` §4.1 [SEC-001], §4.2 [SEC-007], §8 (logging)
- **Acceptance criteria advanced:** AC-03, AC-04
- **Files involved:**
  - `index.html`, `vite.config.ts`: CSP delivery and build configuration
  - `warmly/logging.py`, `warmly/middleware/`: new structured logging and security-header middleware
  - `e2e/fixtures/egress-guard.ts`: new Playwright fixture every spec must import
  - `tests/frontend/setup.ts`: Vitest setup: `fetch` throws for non-allowlisted hosts
  - `docs/security/threat-model.md`: new, first version from PRD §4.1 including residual risks
- **Prior decisions** (full register in `git-issues/2026-11-24_SPEC_summary.md`):
  - CSP: `default-src 'none'`; scripts and styles from `'self'` only, no `unsafe-inline` or `unsafe-eval`; `connect-src` is an explicit allowlist (own API, Supabase Auth; AI provider hosts are added by E05); `frame-ancestors 'none'`; `base-uri 'none'`; `form-action 'self'`.
  - Backend logs are structured JSON with an opaque event ID, route template, status and duration. Never log bodies, headers carrying credentials, query strings or record IDs paired with user identifiers.
  - The egress guard is the standing AC-03 mechanism: later epics assert 'no AI call happened' by relying on it.
  - No third-party analytics or error-reporting SDK (PRD §8).
- **State of the world:** No CSP, no logging configuration, and tests can reach any host.

## Output Format

Deliverable is a single PR containing:

- [ ] CSP and headers in the production build, with a Playwright test that asserts the header values and zero CSP violations on every route
- [ ] Logging module and a test that posts a canary string to every route and asserts it never appears in captured logs
- [ ] Egress guard fixture and Vitest setup, with a self-test proving a rogue request fails the run
- [ ] Threat model document with the residual risks stated honestly
- [ ] Tests written first (TDD), named after the behaviour and citing the PRD IDs above
- [ ] Docstrings / TSDoc for every new public symbol
- [ ] No drive-by changes unrelated to the goal

## Examples

**Test that should pass after this issue lands**
```python
def test_request_body_never_reaches_logs(client, caplog):  # SEC-007, AC-04
    canary = "CANARY-7f3a-journal-plaintext"
    client.post("/v1/sync/operations", json=stub_batch(payload=canary))
    assert canary not in caplog.text
```

## Constraints

**Scope fence:** Do not add authentication or rate limiting here. Do not add AI provider hosts to `connect-src` yet. If you find yourself touching files well
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

`spec-decomposition`, `core`, `foundation`
