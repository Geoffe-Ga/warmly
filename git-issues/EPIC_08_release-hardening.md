<!-- EPIC_08 | title: epic: Post-conversation reflection and release hardening -->

## Epic Summary

Finish the MVP and make it safe to ship without a human in the loop: the optional post-conversation form, an autonomous deploy pipeline that fails closed, smoke checks with rollback-or-halt, verified 30-day backups with a deletion-aware restore drill, cross-browser PWA hardening, the accessibility sweep, and the runbooks. Covers PRD §12 step 8, §3.5 [PC-001..004], §9 [OPS-001..010], §10 [REL-001..012] and §14.

## Scope

**In scope:**
- Hosting decision (ADR-0011), dev and prod environments, the deploy pipeline
- Post-conversation reflection
- Fail-closed release gates, production smoke checks, rollback or halt
- Backups (ADR-0012), retention verification and the restore drill
- PWA behaviour on mobile Safari and desktop, performance budget
- Accessibility sweep, visual polish, documentation and the release checklist

**Out of scope:**
- A staging environment (PRD §8: development and production only)
- Manual accessibility certification, dark theme, export or import (PRD §2.2)
- Routine human approval of releases (PRD §10)

## Success Criteria

The epic is done when:

- [ ] A merge to `main` deploys to production only after every required gate passes, and a missing or inconclusive gate blocks it (AC-24)
- [ ] A failed smoke check rolls back compatible code automatically; an incompatible rollback halts and preserves data (AC-24)
- [ ] A restore from a 30-day-old backup into an isolated target, followed by ledger replay, resurrects no deleted record (AC-25, AC-17)
- [ ] Every screen passes axe on both browsers, and the app installs and works offline on mobile Safari and desktop (AC-23, AC-28)
- [ ] Every acceptance criterion AC-01 to AC-28 maps to a passing automated test in the traceability matrix
- [ ] All child issues are closed
- [ ] `./scripts/check-all.sh` and `./scripts/e2e.sh` pass on `main`

## Child Issues

Work them in this order. Each child lists its own predecessors.

- [ ] #E08_I01_NUMBER — Skeleton: feat(release): choose hosting and wire the dev and prod deploy pipeline end to end
- [ ] #E08_I02_NUMBER — Core: feat(journal): add the optional post-conversation reflection
- [ ] #E08_I03_NUMBER — Core: feat(release): add fail-closed release gates for security and data compatibility
- [ ] #E08_I04_NUMBER — Core: feat(release): add production smoke checks with automatic rollback or halt
- [ ] #E08_I05_NUMBER — Core: feat(ops): verify 30-day encrypted backups and script a deletion-aware restore drill
- [ ] #E08_I06_NUMBER — Edges: test(pwa): harden install, offline, suspend and update behaviour on both supported browsers
- [ ] #E08_I07_NUMBER — Polish: feat(ui): complete the accessibility sweep and visual polish across every screen
- [ ] #E08_I08_NUMBER — Polish: docs(release): complete the documentation set, traceability matrix and release checklist

## Sequencing Notes

**I01 is parallel-safe from the end of epic 01** and should start early so every later epic deploys to the development environment. I02 needs epic 06. I03 to I05 need epic 04. I06 to I08 close out the MVP and need epic 07.

## SPEC Reference

`docs/plans/relationship_communication_agent_prd.md` §12 step 8, §3.5 [PC-001..004], §9 [OPS-001..010], §10 [REL-001..012], §14. Design decisions made during decomposition are
recorded in `git-issues/2026-11-24_SPEC_summary.md`.

## Labels

`epic`, `spec-decomposition`, `release`
