# Documentation

Where each document is. The PRD (§14) lists what the project must
provide; this page maps that list to files, and says plainly what is not
written yet and why.

Start with the [PRD](plans/relationship_communication_agent_prd.md): it
is the source of truth. `CLAUDE.md` at the top of the repository holds
the working rules.

## What the PRD requires

| Required | Where | State |
| --- | --- | --- |
| Architecture diagrams | [architecture/overview.md](architecture/overview.md) | Written |
| Key lifecycle | [architecture/overview.md](architecture/overview.md), [ADR-0003](adr/0003-key-hierarchy-and-envelope.md), [ADR-0004](adr/0004-trusted-device-unlock.md), [ADR-0005](adr/0005-device-identity-and-pairing.md) | Written |
| Threat model | [security/threat-model.md](security/threat-model.md) | Written |
| OpenAPI specification | [`openapi/warmly.v1.json`](../openapi/warmly.v1.json), made from the code ([ADR-0013](adr/0013-api-contract-from-code.md)) | Written; a test fails when it is out of date |
| Encrypted record schema | [ADR-0003](adr/0003-key-hierarchy-and-envelope.md) (envelope), [ADR-0014](adr/0014-local-encrypted-store.md) (local store) | Written |
| Retention and deletion flow | [architecture/overview.md](architecture/overview.md), [ADR-0006](adr/0006-sync-protocol.md) | Written. The 30-day backup limit is not verified (issue 65) |
| Dependency-invalidation cascade | [ADR-0010](adr/0010-dependency-invalidation.md), [architecture/overview.md](architecture/overview.md) | Written |
| Local development and CI | [`README.md`](../README.md), [`CLAUDE.md`](../CLAUDE.md), [runbooks/release-gates.md](runbooks/release-gates.md) | Written |
| Provider compatibility report | None | **Not written.** Needs real provider accounts (issue 41) |
| Backup and restore drill | None | **Not written.** Needs hosting and a real backup service (issue 65) |
| Incident response and rollback runbook | None | **Not written.** Needs a deploy pipeline to roll back (issues 61 and 64) |
| Machine-executable release checklist | [release-checklist.md](release-checklist.md) is a list for people; the checks that are executable today are the Release Gate ([runbooks/release-gates.md](runbooks/release-gates.md)) | **Partly.** The items that need hosting cannot be run yet |

## Everything else

- **Decisions:** [adr/](adr/README.md).
- **Security:** [authentication](security/authentication.md), the
  [isolation test matrix](security/isolation-test-matrix.md) (generated),
  the [threat model](security/threat-model.md).
- **Runbooks:** [release gates](runbooks/release-gates.md),
  [sync versions](runbooks/sync-versions.md).
- **Accessibility:** [accessibility.md](accessibility.md): what is checked
  by machine and what no person has checked.
- **Browsers and devices:** [support/browsers.md](support/browsers.md),
  with the manual checks to do on real devices before launch.
- **Acceptance criteria and tests:** [traceability.md](traceability.md)
  (generated).
- **Before real users:** [release-checklist.md](release-checklist.md).
- **Design:** [`DESIGN.md`](../DESIGN.md).

## Writing here

- Describe what was built and tested. Do not claim a security property
  beyond the evidence (PRD §13.9).
- Say what was not checked, and by whom it must be.
- A generated file says so at its top and is never edited by hand.
