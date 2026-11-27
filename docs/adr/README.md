# Architecture Decision Records

An ADR records one decision that is expensive to reverse: what was chosen, what
else was considered, and why. Write one before the code that depends on it.

## Index

| ADR | Decision | Status |
| --- | --- | --- |
| [0001](0001-ui-framework.md) | UI framework: Preact with TSX | Accepted |
| [0002](0002-backend-data-access.md) | Backend data access: private schema, restricted role, owner per transaction, SQL migrations | Accepted |
| [0003](0003-key-hierarchy-and-envelope.md) | Key hierarchy and the record envelope: WebCrypto, a key per record, AES-256-GCM | Accepted |
| [0004](0004-trusted-device-unlock.md) | Trusted-device unlock and the inactivity lock | Accepted |
| [0005](0005-device-identity-and-pairing.md) | Device identity, request signing and pairing | Accepted (pairing pending #22) |
| [0006](0006-sync-protocol.md) | The sync protocol: per-record revisions with compare-and-swap, an idempotent operation log and a per-owner change feed | Accepted |
| [0007](0007-ai-provider-browser-access.md) | Calling an AI provider from the browser with the person's own key: both accepted with conditions, pending the owner's acceptance of the risks | Proposed |
| [0008](0008-ai-grounding-contract.md) | The AI answer contract: per-request names and exact quotes, checked against what was sent, all or nothing | Accepted |
| [0009](0009-reflect-context-selection.md) | Which entries a Reflect request sends when the journal is too long: newest, relevant, then an even spread; whole entries; always disclosed | Accepted |
| [0010](0010-dependency-invalidation.md) | What is removed when a journal entry changes: every reflection built from it, whole, as an ordinary deletion, decided on the device from the records themselves | Accepted |
| [0013](0013-api-contract-from-code.md) | API contract generated from code, with an isolated type generator | Accepted |
| [0014](0014-local-encrypted-store.md) | The local encrypted record store: a row per record, an outbox in the same transaction, forward-only migrations | Accepted |
| [0015](0015-unsaved-edits.md) | Unsaved edits to a finished entry: kept on the device as an encrypted row of their own, never the entry, never synced | Accepted |
| [0016](0016-write-based-on-a-read.md) | A write names the copy it was made to, and the store compares it as part of the write | Accepted |
| [0017](0017-tabs-tell-each-other.md) | Tabs tell each other that something changed: a fixed word on a channel, and each tab reads the stored rows itself | Accepted |

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
