# Architecture Decision Records

An ADR records one decision that is expensive to reverse: what was chosen, what
else was considered, and why. Write one before the code that depends on it.

## Index

| ADR | Decision | Status |
| --- | --- | --- |
| [0001](0001-ui-framework.md) | UI framework: Preact with TSX | Accepted |
| [0002](0002-backend-data-access.md) | Backend data access: private schema, restricted role, owner per transaction, SQL migrations | Accepted |
| [0003](0003-key-hierarchy-and-envelope.md) | Key hierarchy and the record envelope: WebCrypto, a key per record, AES-256-GCM | Accepted |
| [0013](0013-api-contract-from-code.md) | API contract generated from code, with an isolated type generator | Accepted |

## How to add one

1. Copy the template below to `NNNN-short-title.md`, using the next number.
2. Compare two to four real options with facts, not adjectives.
3. Add a row to the index above in the same pull request.

Never edit the decision of an accepted ADR. Write a new ADR that supersedes it
and update the old one's status line.

## Template

```markdown
# ADR-NNNN: Title

- **Status:** Proposed | Accepted | Superseded by ADR-NNNN
- **Date:** YYYY-MM-DD
- **PRD references:** section and requirement IDs

## Context

Why this decision is needed now, and what it affects.

## Options

### Option 1: Name

What it involves. Pros. Cons. Effort. Maintenance impact.

### Option 2: Name

...

## Comparison

| Dimension | Option 1 | Option 2 |
| --- | --- | --- |

## Decision

What was chosen and the reasoning that decided it.

## Consequences

What becomes easier, what becomes harder, and what must be revisited.
```
