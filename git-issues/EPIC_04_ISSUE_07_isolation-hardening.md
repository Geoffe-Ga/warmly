<!-- E04-I07 | title: test(sync): prove cross-account isolation and ciphertext-only handling, and add rate limits -->

## Role

You are a senior security engineer working across `warmly/`, `tests/` and `e2e/`.

## Goal

Add an adversarial test suite that proves one account cannot read, change or detect another's data through any sync or device route, that plaintext never appears in requests, rows or logs, and add per-account rate limits.

## Context

- **Parent epic:** #EPIC_04_NUMBER (Encrypted multi-device sync)
- **Predecessor issue(s):** #E04_I06_NUMBER (E04-I06: feat(sync): make deletion durable so stale devices cannot resurrect records). Each must be merged first.
- **SPEC section:** `docs/plans/relationship_communication_agent_prd.md` §4.2 [SEC-005, SEC-006], §5.2 [SYNC-007, SYNC-011], §8
- **Acceptance criteria advanced:** AC-04, AC-05, AC-27, AC-20
- **Files involved:**
  - `tests/security/`: new adversarial API suite
  - `e2e/isolation.spec.ts`: new two-account end-to-end test
  - `warmly/middleware/rate_limit.py`: new per-account limiter
  - `docs/security/isolation-test-matrix.md`: new route-by-attack matrix
- **Prior decisions** (full register in `git-issues/2026-11-24_SPEC_summary.md`):
  - The matrix is generated from the OpenAPI file: every route times every attack (other owner's record ID, device ID, conflict ID, enrollment ID; owner field injected in body, query and header; replayed signature; revoked device; stale JWT). A new route without matrix coverage fails the suite.
  - Responses for 'not yours' and 'does not exist' are indistinguishable in status, body and (within tolerance) timing.
  - The ciphertext check runs a full two-device scenario with canary strings, then searches captured HTTP bodies, every database row and all logs for them.
  - Rate limits are per account and per device, return 429 with `Retry-After`, and are stored in PostgreSQL or another shared store so they hold with more than one API instance.
  - State what the suite does not prove (PRD §13.9).
- **State of the world:** Each route has its own ownership tests, written by its author. There is no systematic adversarial coverage and no rate limiting.

## Output Format

Deliverable is a single PR containing:

- [ ] Generated matrix suite and the coverage check for new routes
- [ ] Two-account E2E: account B's client, with modified requests, cannot see any trace of account A
- [ ] Canary scan across requests, rows and logs
- [ ] Rate limiter with tests, and a test that no route offers any way to link two accounts (AC-27)
- [ ] Tests written first (TDD), named after the behaviour and citing the PRD IDs above
- [ ] Docstrings / TSDoc for every new public symbol
- [ ] No drive-by changes unrelated to the goal

## Examples

**Test that should pass after this issue lands**
```python
@pytest.mark.parametrize("route,attack", ISOLATION_MATRIX)
def test_cross_owner_access_is_indistinguishable_from_missing(route, attack, owner_a, owner_b):
    real = attack.run(route, actor=owner_b, target=owner_a.resource)     # SEC-006, AC-05
    ghost = attack.run(route, actor=owner_b, target=random_resource())
    assert (real.status_code, real.json()) == (ghost.status_code, ghost.json())
```

## Constraints

**Scope fence:** If the suite finds a real hole, fix it in this PR only when the fix is small; otherwise file an issue and mark the test as an expected failure with that issue's number, never skipped. If you find yourself touching files well
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
- [ ] PR body includes `Refs #EPIC_04_NUMBER` and `Closes` this issue's number.
- [ ] CI is green and the Claude reviewer's latest `Verdict:` on HEAD is `LGTM`.

## Labels

`spec-decomposition`, `edges`, `sync`
