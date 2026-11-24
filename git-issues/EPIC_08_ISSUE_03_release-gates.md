<!-- E08-I03 | title: feat(release): add fail-closed release gates for security and data compatibility -->

## Role

You are a senior platform engineer (GitHub Actions, managed hosting, PostgreSQL operations) working in this repo.

## Goal

Replace the placeholder release-gates stage with a single aggregate gate that allows production deployment only when every required check has run and passed, including security scans and encrypted-fixture compatibility, and that treats a missing or inconclusive result as failure.

## Context

- **Parent epic:** #EPIC_08_NUMBER (Post-conversation reflection and release hardening)
- **Predecessor issue(s):** #E08_I01_NUMBER (E08-I01: feat(release): choose hosting and wire the dev and prod deploy pipeline end to end); #E04_I08_NUMBER (E04-I08: feat(sync): negotiate schema versions and update the app without losing work). Each must be merged first.
- **SPEC section:** `docs/plans/relationship_communication_agent_prd.md` §10 [REL-001, REL-002, REL-003, REL-004, REL-008]
- **Acceptance criteria advanced:** AC-24, AC-04
- **Files involved:**
  - `.github/workflows/ci.yml`, `deploy.yml`: required jobs and the aggregate gate
  - `scripts/release/gate.py`: new: evaluates a manifest of required checks
  - `release/required-checks.yml`: new machine-readable manifest
  - `tests/release/`: new tests of the gate logic
- **Prior decisions** (full register in `git-issues/2026-11-24_SPEC_summary.md`):
  - The manifest names every required check: lint, types, pytest, Vitest, Playwright and axe, the isolation suite, crypto fixture compatibility, recovery, revocation, sync conflict and deletion, IndexedDB migration, source invalidation, dependency scan, secret scan and SAST.
  - The gate reads check results from the CI API and fails unless each named check is present, completed and successful. Skipped, cancelled, neutral and missing all count as failure (REL-002).
  - High or critical findings block. The existing Bandit step uses `|| true` followed by a separate result check; verify it truly fails closed and fix it if not.
  - A CI check fails any PR that removes an entry from the manifest, deletes a test file from a required suite, or lowers a threshold, unless the PR carries an explicit `release-policy-change` label applied by a human (REL-002).
  - There is no manual approval step in the normal path (REL-003).
- **State of the world:** The pipeline deploys to development; the production gate is a placeholder that always fails.

## Output Format

Deliverable is a single PR containing:

- [ ] Manifest, gate script and workflow wiring
- [ ] Gate tests: all green passes; each of missing, skipped, cancelled and failed blocks
- [ ] The policy-change guard with tests
- [ ] A secret-scanning job and a SAST job if not already present, pinned by commit SHA
- [ ] Tests written first (TDD), named after the behaviour and citing the PRD IDs above
- [ ] Docstrings / TSDoc for every new public symbol
- [ ] No drive-by changes unrelated to the goal

## Examples

**Test that should pass after this issue lands**
```python
@pytest.mark.parametrize("state", ["missing", "skipped", "cancelled", "neutral", "failure"])
def test_gate_fails_closed(state):                         # REL-002, AC-24
    results = all_green() | {"isolation-suite": state}
    assert evaluate(REQUIRED, results).allowed is False
```

## Constraints

**Scope fence:** Do not enable production deployment yet (E08-I04). Do not weaken or remove any existing check to make the gate pass. If you find yourself touching files well
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
- [ ] PR body includes `Refs #EPIC_08_NUMBER` and `Closes` this issue's number.
- [ ] CI is green and the Claude reviewer's latest `Verdict:` on HEAD is `LGTM`.

## Labels

`spec-decomposition`, `core`, `release`
