<!-- E04-I03 | title: feat(sync): serve the owner-scoped change feed with a stable cursor -->

## Role

You are a senior Python engineer working in this repo's `warmly/` FastAPI package on PostgreSQL.

## Goal

Make `GET /v1/sync/changes` return every record version an owner's device has not seen, in sequence order with pagination, and record each device's last successful sync.

## Context

- **Parent epic:** #EPIC_04_NUMBER (Encrypted multi-device sync)
- **Predecessor issue(s):** #E04_I02_NUMBER (E04-I02: feat(sync): persist operations with atomic revisions, compare-and-swap and idempotency). Each must be merged first.
- **SPEC section:** `docs/plans/relationship_communication_agent_prd.md` §5.2 [SYNC-002, SYNC-003], §4.3 [DEV-002]
- **Acceptance criteria advanced:** AC-05
- **Files involved:**
  - `warmly/services/sync_read.py`: new feed query
  - `warmly/api/sync.py`: real changes route
  - `supabase/migrations/`: index on `(owner_id, sequence)`; `devices.last_sync_at`
  - `tests/api/test_sync_changes.py`: new
- **Prior decisions** (full register in `git-issues/2026-11-24_SPEC_summary.md`):
  - The cursor is the last per-owner sequence number the device applied, as an opaque string. The feed returns the **current** state of each record changed after it, ordered by sequence, with `has_more`.
  - The feed must not skip a change committed concurrently with the read. Use a sequence allocation that cannot expose a higher number before a lower one commits, and prove it with a test.
  - An unknown or future cursor returns a typed error telling the client to resync from zero; it never returns another owner's data.
  - A successful final page updates `devices.last_sync_at`, which Manage Devices already displays.
- **State of the world:** Operations persist. The changes route still returns an empty stub.

## Output Format

Deliverable is a single PR containing:

- [ ] Feed query, route and pagination with a server-enforced page-size limit
- [ ] Tests: ordering, pagination across a batch boundary, tombstones included, a second owner sees nothing, a revoked device gets 401
- [ ] Concurrency test for the no-skipped-change guarantee
- [ ] Manage Devices shows the real last-sync time
- [ ] Tests written first (TDD), named after the behaviour and citing the PRD IDs above
- [ ] Docstrings / TSDoc for every new public symbol
- [ ] No drive-by changes unrelated to the goal

## Examples

**Request/response**
```
GET /v1/sync/changes?cursor=41
200 OK
{ "changes": [ { "record_id": "r-1", "type": 1, "revision": 3, "sequence": 42,
                 "schema_version": 1, "tombstone": false, "etag": "…", "payload": "b64…" } ],
  "next_cursor": "42", "has_more": false }
```

## Constraints

**Scope fence:** No long polling, WebSocket or push. No per-type filtering. If you find yourself touching files well
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
