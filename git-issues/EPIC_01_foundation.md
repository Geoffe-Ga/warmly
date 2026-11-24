<!-- EPIC_01 | title: epic: Foundation and walking skeleton -->

## Epic Summary

Turn the scaffold into a walking skeleton: every MVP screen reachable as an accessible placeholder, every `/v1` endpoint answering with typed stub data, a shared typed contract between them, a real database with deny-by-default policies, and the security guard rails (CSP, log redaction, network egress guard) that every later epic relies on. Covers PRD §12 step 1, §3.1 [UX-001], §3.6 [UI-001..008] and §8.

## Scope

**In scope:**
- ADR-0001 (UI framework) and the routed app shell with placeholder screens
- FastAPI app with every `/v1` route stubbed, committed OpenAPI contract, generated TypeScript types
- Design tokens and the accessible component kit for the light-only theme
- CSP and security headers, backend log redaction, the test network egress guard
- Development database stack, migration runner, dev/prod configuration split

**Out of scope:**
- Real authentication, crypto, storage, sync or AI (epics 02 to 07)
- Deployment, hosting and backups (epic 08)

## Success Criteria

The epic is done when:

- [ ] A user can open the built PWA, see exactly three primary Home actions and navigate to a placeholder for every MVP screen
- [ ] `GET /v1/health` and every other `/v1` route respond with schema-valid bodies, and the frontend types are generated from the same OpenAPI file
- [ ] Any test that makes a request to a host outside the allowlist fails automatically
- [ ] Backend logs provably contain no request bodies
- [ ] All child issues are closed
- [ ] `./scripts/check-all.sh` and `./scripts/e2e.sh` pass on `main`

## Child Issues

Work them in this order. Each child lists its own predecessors.

- [ ] #E01_I01_NUMBER — Skeleton: feat(shell): adopt Preact and wire every MVP route to a placeholder screen
- [ ] #E01_I02_NUMBER — Skeleton: feat(api): wire every /v1 route with typed stubs and a committed OpenAPI contract
- [ ] #E01_I03_NUMBER — Core: feat(ui): add light-theme design tokens and the accessible component kit
- [ ] #E01_I04_NUMBER — Core: feat(security): add CSP, security headers, log redaction and the network egress guard
- [ ] #E01_I05_NUMBER — Core: feat(db): add the dev database stack, migration runner and deny-by-default baseline

## Sequencing Notes

**Blocks:** every other epic. **Parallel-safe inside the epic:** I03 and I04 can run alongside I02 once I01 has merged; I05 needs I02.

## SPEC Reference

`docs/plans/relationship_communication_agent_prd.md` §12 step 1, §3.1, §3.6, §8, §10 (CI basics). Design decisions made during decomposition are
recorded in `git-issues/2026-11-24_SPEC_summary.md`.

## Labels

`epic`, `spec-decomposition`, `foundation`
