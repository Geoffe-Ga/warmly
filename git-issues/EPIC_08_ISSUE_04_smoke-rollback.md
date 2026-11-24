<!-- E08-I04 | title: feat(release): add production smoke checks with automatic rollback or halt -->

## Role

You are a senior platform engineer (GitHub Actions, managed hosting, PostgreSQL operations) working in this repo.

## Goal

Enable autonomous production deployment with a post-release smoke check that proves availability, authentication and a ciphertext round trip with synthetic data, rolls back automatically when the previous release is data-compatible, and otherwise halts all deployment and raises an incident.

## Context

- **Parent epic:** #EPIC_08_NUMBER (Post-conversation reflection and release hardening)
- **Predecessor issue(s):** #E08_I03_NUMBER (E08-I03: feat(release): add fail-closed release gates for security and data compatibility). Each must be merged first.
- **SPEC section:** `docs/plans/relationship_communication_agent_prd.md` §10 [REL-005, REL-006, REL-007], §8 (health checks)
- **Acceptance criteria advanced:** AC-24
- **Files involved:**
  - `scripts/smoke.sh`, `scripts/release/smoke.py`: full smoke check
  - `scripts/release/rollback.py`: new rollback-or-halt decision
  - `release/compatibility.yml`: new declared data-compatibility of each release
  - `.github/workflows/deploy.yml`: enable production stages
  - `docs/runbooks/incident-and-rollback.md`: new
- **Prior decisions** (full register in `git-issues/2026-11-24_SPEC_summary.md`):
  - The smoke check signs in as a dedicated synthetic production account with its own device key, pushes a random ciphertext record, pulls it back, compares bytes and tombstones it. It touches no real user's data (REL-006, REL-007).
  - Each release declares in `release/compatibility.yml` whether the previous release can run against its database schema. Expand/migrate/contract migrations keep that true by default.
  - On smoke failure: if the previous release is declared compatible, redeploy it automatically. If not, do **not** roll back: stop the pipeline, set a repository flag that blocks further deploys, keep all data, and open an incident issue containing no secrets or user content (REL-005).
  - No migration is ever reverted destructively by automation.
  - Database backups are verified as present before any migration flagged as destructive runs (REL-006); the check itself is provided by E08-I05 and wired here as a required input once available.
- **State of the world:** Gates work; production stages are present but disabled.

## Output Format

Deliverable is a single PR containing:

- [ ] Smoke check, rollback-or-halt logic and the compatibility manifest with tests for both branches
- [ ] Production stages enabled behind the passing gate
- [ ] A rehearsal recorded in the runbook: deliberately failing build rolled back in development
- [ ] Incident and rollback runbook
- [ ] Tests written first (TDD), named after the behaviour and citing the PRD IDs above
- [ ] Docstrings / TSDoc for every new public symbol
- [ ] No drive-by changes unrelated to the goal

## Examples

**Test that should pass after this issue lands**
```python
def test_incompatible_release_halts_instead_of_rolling_back():   # REL-005, AC-24
    decision = decide(smoke_passed=False, previous_compatible=False)
    assert decision.action == "halt"
    assert decision.blocks_further_deploys and decision.data_preserved
```

## Constraints

**Scope fence:** No blue/green infrastructure beyond what the host provides. No alerting vendor integration beyond the incident issue. If you find yourself touching files well
outside the list above, stop and check with the user.

**Needs a human:** Creating the synthetic production account and approving the first production enablement. An agent must not create accounts, enter payment details or handle live secrets. Do everything else, then stop and report exactly what the human must do.

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

`spec-decomposition`, `core`, `release`, `needs-human`
