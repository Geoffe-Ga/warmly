<!-- E01-I05 | title: feat(db): add the dev database stack, migration runner and deny-by-default baseline -->

## Role

You are a senior Python engineer working in this repo's `warmly/` FastAPI package.

## Goal

Give the backend a real PostgreSQL in development and CI, a repeatable migration runner, separate dev/prod configuration, and a `/v1/ready` check that proves database connectivity, all under a deny-by-default access model.

## Context

- **Parent epic:** #EPIC_01_NUMBER (Foundation and walking skeleton)
- **Predecessor issue(s):** #E01_I02_NUMBER (E01-I02: feat(api): wire every /v1 route with typed stubs and a committed OpenAPI contract). Each must be merged first.
- **SPEC section:** `docs/plans/relationship_communication_agent_prd.md` §8, §7 (migrations), §4.2 [SEC-006]
- **Acceptance criteria advanced:** AC-05
- **Files involved:**
  - `docs/adr/0002-backend-data-access.md`: new ADR
  - `supabase/migrations/`: new SQL migrations, starting with schema, roles and default-deny
  - `warmly/config.py`, `warmly/db/`: typed settings and connection/transaction helpers
  - `tests/db/`: new integration tests against a real Postgres
  - `.github/workflows/ci.yml`: add a Postgres service to the Python job
- **Prior decisions** (full register in `git-issues/2026-11-24_SPEC_summary.md`):
  - D-08: all application tables live in a schema that is **not exposed** through the Supabase Data API (for example `warmly_private`). The browser uses Supabase for Auth only. This prevents a stolen JWT from reading ciphertext while bypassing the device check.
  - D-08: FastAPI connects with a role that has no `BYPASSRLS`, sets the authenticated owner per transaction, and every table has RLS enabled with owner-only policies. The service-role key is never used for data access.
  - Migrations are plain forward-only SQL, expand/migrate/contract style, idempotent where rollback depends on them (PRD §7, §10).
  - Development uses synthetic fixtures only. Nothing may read production data (PRD §8, §10).
- **State of the world:** Routes return stubs; there is no database, no settings module and no migration tooling.

## Output Format

Deliverable is a single PR containing:

- [ ] ADR-0002 covering driver choice, role model, per-transaction owner setting and migration tooling
- [ ] Migration 0001: schema, roles, default-deny grants, and a test table used only to prove the policy pattern
- [ ] Settings object that refuses to start in `production` with any dev default
- [ ] `/v1/ready` returning 503 when the database is unreachable
- [ ] Tests: a second owner cannot read or write the first owner's row; the anon and authenticated Data API roles have no privileges on the schema
- [ ] Tests written first (TDD), named after the behaviour and citing the PRD IDs above
- [ ] Docstrings / TSDoc for every new public symbol
- [ ] No drive-by changes unrelated to the goal

## Examples

**Test that should pass after this issue lands**
```python
async def test_owner_b_cannot_see_owner_a_rows(db):  # SEC-006, AC-05
    await insert_probe(db, owner=OWNER_A)
    async with db.as_owner(OWNER_B) as tx:
        assert await tx.fetch("select * from warmly_private.policy_probe") == []
```

## Constraints

**Scope fence:** No sync, device or recovery tables yet; each arrives with the issue that uses it. Do not provision any cloud project. If you find yourself touching files well
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
- [ ] PR body includes `Refs #EPIC_01_NUMBER` and `Closes` this issue's number.
- [ ] CI is green and the Claude reviewer's latest `Verdict:` on HEAD is `LGTM`.

## Labels

`spec-decomposition`, `core`, `foundation`
