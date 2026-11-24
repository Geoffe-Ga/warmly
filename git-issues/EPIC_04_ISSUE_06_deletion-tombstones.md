<!-- E04-I06 | title: feat(sync): make deletion durable so stale devices cannot resurrect records -->

## Role

You are a senior full-stack engineer (TypeScript PWA and Python FastAPI on PostgreSQL) who has built offline-first sync.

## Goal

Guarantee that a deleted record stays deleted across every device and ordering: tombstones are permanent, edit-versus-delete is reconciled explicitly, and every deletion is written to an append-only ledger.

## Context

- **Parent epic:** #EPIC_04_NUMBER (Encrypted multi-device sync)
- **Predecessor issue(s):** #E04_I05_NUMBER (E04-I05: feat(sync): keep both conflicting versions and let the user resolve them locally). Each must be merged first.
- **SPEC section:** `docs/plans/relationship_communication_agent_prd.md` §5.2 [SYNC-005, SYNC-007], §9 [OPS-003, OPS-004]
- **Acceptance criteria advanced:** AC-17, AC-16
- **Files involved:**
  - `warmly/services/sync_write.py`: tombstone rules
  - `supabase/migrations/`: `deletion_ledger` (append-only) and constraints
  - `src/sync/apply.ts`, `src/sync/conflicts.ts`: client handling of `deleted` and delete conflicts
  - `docs/adr/0006-sync-protocol.md`: add the deletion and compaction section
- **Prior decisions** (full register in `git-issues/2026-11-24_SPEC_summary.md`):
  - D-11: a tombstone drops the ciphertext and keeps the record ID, owner, revision and sequence. Tombstones are **never compacted in the MVP**; the storage cost is a few bytes per deletion and it removes the stale-device recovery problem entirely. Record this in the ADR.
  - A database constraint makes a tombstoned record immutable: no later operation can clear the flag or attach a payload.
  - D-10: an update whose target is tombstoned returns `deleted`. The client never re-uploads under that ID. It shows the user their unsynced text and offers 'Save as a new entry' (new record ID) or 'Discard'.
  - A delete whose `base_revision` is stale (someone edited the record) is a conflict for the user: 'Delete anyway' or 'Keep the edited version'.
  - Every tombstone also appends `(owner, record_id, deleted_at)` to `deletion_ledger`, which holds no content and is retained independently of rolling backups (used by E08-I05).
- **State of the world:** The tombstone flag is stored and fed to devices, but nothing prevents a later update from overwriting it.

## Output Format

Deliverable is a single PR containing:

- [ ] Write-path rules, constraint and ledger with tests through the scenario table
- [ ] Client flows for `deleted` and delete-versus-edit, with accurate copy
- [ ] Property-style test: for random interleavings of create, edit and delete across three devices, no tombstoned record is ever readable afterwards and all devices converge
- [ ] E2E: device B, offline since before the delete, edits and then syncs; the record stays deleted and B is offered 'Save as a new entry'
- [ ] Tests written first (TDD), named after the behaviour and citing the PRD IDs above
- [ ] Docstrings / TSDoc for every new public symbol
- [ ] No drive-by changes unrelated to the goal

## Examples

**Request/response**
```
POST /v1/sync/operations      (r-1 was deleted at revision 4; stale device still at 3)
{ "operations": [ { "op_id": "o-9", "record_id": "r-1", "type": 1,
    "base_revision": 3, "schema_version": 1, "tombstone": false, "payload": "b64…" } ] }

200 OK
{ "results": [ { "op_id": "o-9", "status": "deleted", "current_revision": 4 } ] }
```

## Constraints

**Scope fence:** No tombstone compaction and no backup tooling. Cascades to AI-derived records are E06-I05; this issue only guarantees the delete primitive. If you find yourself touching files well
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
- [ ] `./scripts/e2e.sh` passes on desktop Chromium and mobile Safari, including axe checks for every screen this PR touches.
- [ ] `pre-commit run --all-files` is clean: no skipped hooks, no bypassed checks.
- [ ] Public API changes are reflected in docstrings and user-facing docs.
- [ ] PR body includes `Refs #EPIC_04_NUMBER` and `Closes` this issue's number.
- [ ] CI is green and the Claude reviewer's latest `Verdict:` on HEAD is `LGTM`.

## Labels

`spec-decomposition`, `core`, `sync`
