<!-- E08-I01 | title: feat(release): choose hosting and wire the dev and prod deploy pipeline end to end -->

## Role

You are a senior platform engineer (GitHub Actions, managed hosting, PostgreSQL operations) working in this repo.

## Goal

Record the hosting decision in ADR-0011 and wire a pipeline that builds once, deploys the frontend and API to a development environment on every merge to `main`, runs a smoke check, and has clearly marked placeholder stages for the production gates, smoke and rollback that later issues fill in.

## Context

- **Parent epic:** #EPIC_08_NUMBER (Post-conversation reflection and release hardening)
- **Predecessor issue(s):** #E01_I05_NUMBER (E01-I05: feat(db): add the dev database stack, migration runner and deny-by-default baseline). Each must be merged first.
- **SPEC section:** `docs/plans/relationship_communication_agent_prd.md` §8, §10 [REL-001, REL-003, REL-007], §2.1
- **Acceptance criteria advanced:** AC-24
- **Files involved:**
  - `docs/adr/0011-hosting-and-environments.md`: new ADR
  - `.github/workflows/deploy.yml`: new pipeline
  - `deploy/`: new host configuration, including production security headers
  - `scripts/smoke.sh`: new smoke check: health, ready
  - `docs/runbooks/environments.md`: new: what exists where, and who can touch it
- **Prior decisions** (full register in `git-issues/2026-11-24_SPEC_summary.md`):
  - Requirements for the ADR: static hosting that can send the CSP and security headers from E01-I04 on every response; a managed container or serverless host for FastAPI in a region near the database; atomic deploys with instant rollback to a previous build; secrets held in the platform or GitHub environments, never in the repo.
  - Exactly two environments, development and production, with separate Supabase projects, secrets and storage. No staging (PRD §8).
  - Build once and promote the same artefact. Production deploys run only from `main`.
  - Agents and CI never read production user data. Smoke checks use dedicated synthetic accounts (REL-007).
  - D-26: disable open public sign-up in the production Supabase project (allow-list or invite) unless the product owner decides otherwise. The MVP is for two known users and open registration invites abuse.
- **State of the world:** CI runs quality checks only. Nothing is deployed anywhere.

## Output Format

Deliverable is a single PR containing:

- [ ] ADR-0011 comparing at least two options per tier, with costs
- [ ] `deploy.yml` deploying to development with a passing smoke check, and production stages present but gated off behind an explicit `production_enabled` variable
- [ ] A test of the pipeline's own logic (for example with `act` or extracted scripts under shellcheck) so gate ordering is not verified by hand
- [ ] Environment runbook listing every secret by name and where it is stored, with no values
- [ ] Tests written first (TDD), named after the behaviour and citing the PRD IDs above
- [ ] Docstrings / TSDoc for every new public symbol
- [ ] No drive-by changes unrelated to the goal

## Examples

**Pipeline shape after this issue lands**
```
build ──▶ deploy-dev ──▶ smoke-dev
                             │
                             ▼
        release-gates (placeholder, fails closed) ──▶ deploy-prod (disabled)
                                                    ──▶ smoke-prod ──▶ rollback | halt (placeholders)
```

## Constraints

**Scope fence:** Do not enable production deployment, and do not implement the real gates, rollback or backups here. If you find yourself touching files well
outside the list above, stop and check with the user.

**Needs a human:** Choosing and paying for the hosting accounts, creating the development and production Supabase projects, and entering secrets into the platform. An agent must not create accounts, enter payment details or handle live secrets. Do everything else, then stop and report exactly what the human must do.

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

`spec-decomposition`, `tracer-skeleton`, `release`, `needs-human`
