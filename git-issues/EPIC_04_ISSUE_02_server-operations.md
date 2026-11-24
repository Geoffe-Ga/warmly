<!-- E04-I02 | title: feat(sync): persist operations with atomic revisions, compare-and-swap and idempotency -->

## Role

You are a senior Python engineer working in this repo's `warmly/` FastAPI package on PostgreSQL.

## Goal

Make `POST /v1/sync/operations` real: store ciphertext in PostgreSQL, assign revisions atomically, apply an operation only when its base revision matches, and treat a repeated `op_id` as a no-op.

## Context

- **Parent epic:** #EPIC_04_NUMBER (Encrypted multi-device sync)
- **Predecessor issue(s):** #E04_I01_NUMBER (E04-I01: feat(sync): wire the client sync engine and status indicator against the stub API). Each must be merged first.
- **SPEC section:** `docs/plans/relationship_communication_agent_prd.md` §5.2 [SYNC-003, SYNC-008], §8
- **Acceptance criteria advanced:** AC-04, AC-05, AC-16
- **Files involved:**
  - `supabase/migrations/`: `records`, `owner_sequences`, `operation_receipts` with RLS
  - `warmly/services/sync_write.py`: new transactional apply logic
  - `warmly/api/sync.py`: real operations route
  - `tests/api/test_sync_operations.py`, `tests/db/`: new
- **Prior decisions** (full register in `git-issues/2026-11-24_SPEC_summary.md`):
  - D-10: within one transaction per operation, lock the record row, compare `base_revision`, write the new ciphertext, increment the record revision and take the next per-owner sequence number. Never compare timestamps and never let the latest writer win.
  - A receipt keyed by `(owner, op_id)` stores the original result; a retry returns it unchanged with status `duplicate` semantics and creates nothing (SYNC-008).
  - A stale `base_revision` returns `conflict`. In this issue the incoming ciphertext is rejected and **not** stored; retaining it is E04-I05. Existing data is never overwritten.
  - The server stores the payload as opaque bytes, with a size limit, and computes an ETag from the ciphertext. It never decodes it.
  - Owner comes from the JWT; device proof from E02-I06 is required. The primary key is `(owner_id, record_id)`, so another owner's record ID is simply a different row: one account can neither touch nor detect another's records.
- **State of the world:** The operations route returns a fixed `applied` stub and persists nothing.

## Output Format

Deliverable is a single PR containing:

- [ ] Migrations with owner-only RLS and tests through a second owner
- [ ] Service and route, with the ADR-0006 scenario table as parametrised tests
- [ ] Concurrency test: 20 parallel updates from one base revision yield exactly one `applied`
- [ ] Batch semantics: each operation succeeds or fails on its own, and results keep request order
- [ ] Tests written first (TDD), named after the behaviour and citing the PRD IDs above
- [ ] Docstrings / TSDoc for every new public symbol
- [ ] No drive-by changes unrelated to the goal

## Examples

**Request/response**
```
POST /v1/sync/operations
{ "operations": [ { "op_id": "o-2", "record_id": "r-1", "type": 1,
    "base_revision": 1, "schema_version": 1, "tombstone": false, "payload": "b64…" } ] }

200 OK        (record r-1 is already at revision 2)
{ "results": [ { "op_id": "o-2", "status": "conflict", "current_revision": 2 } ] }
```

## Constraints

**Scope fence:** No change feed (E04-I03), no stored conflict variants (E04-I05), no tombstone rules beyond storing the flag (E04-I06). If you find yourself touching files well
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
- [ ] PR body includes `Refs #EPIC_04_NUMBER` and `Closes` this issue's number.
- [ ] CI is green and the Claude reviewer's latest `Verdict:` on HEAD is `LGTM`.

## Labels

`spec-decomposition`, `core`, `sync`
