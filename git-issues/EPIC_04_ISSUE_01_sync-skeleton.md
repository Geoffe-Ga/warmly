<!-- E04-I01 | title: feat(sync): wire the client sync engine and status indicator against the stub API -->

## Role

You are a senior full-stack engineer (TypeScript PWA and Python FastAPI on PostgreSQL) who has built offline-first sync.

## Goal

Record ADR-0006 and connect a `SyncEngine` to the existing stub endpoints so that the outbox is sent, changes are requested, and a status indicator shows synced, pending, offline or needs-attention, with an in-memory server double used by tests.

## Context

- **Parent epic:** #EPIC_04_NUMBER (Encrypted multi-device sync)
- **Predecessor issue(s):** #E03_I08_NUMBER (E03-I08: feat(journal): handle storage errors, suspend and resume, and the installed offline app); #E02_I08_NUMBER (E02-I08: feat(devices): revoke a device and handle rejection on the revoked client). Each must be merged first.
- **SPEC section:** `docs/plans/relationship_communication_agent_prd.md` §5.2 [SYNC-002, SYNC-010]
- **Acceptance criteria advanced:** AC-23
- **Files involved:**
  - `docs/adr/0006-sync-protocol.md`: new ADR: operations, statuses, cursor, conflicts, tombstones
  - `src/sync/engine.ts`, `src/sync/transport.ts`: new engine and typed transport over `src/api/`
  - `src/sync/testing/memory-server.ts`: new in-memory server double implementing the ADR
  - `src/ui/components/SyncStatus.tsx`: new status indicator
  - `warmly/schemas/sync.py`: align stub models with the ADR
- **Prior decisions** (full register in `git-issues/2026-11-24_SPEC_summary.md`):
  - D-10 protocol: the cursor is a per-owner monotonic change sequence. Each record has a server-assigned `revision`. An operation carries `op_id`, `record_id`, `type`, `base_revision`, `schema_version`, `tombstone` and an opaque `payload`. Result statuses: `applied`, `duplicate`, `conflict`, `deleted`, `rejected`.
  - The memory server double is the executable specification: client tests and backend tests assert the same scenario table from the ADR.
  - Status text never contains private content: 'All changes saved', '3 changes waiting to sync', 'Offline', 'Needs your attention' (SYNC-010).
  - Network sync retries are allowed and idempotent. This is unrelated to AI calls, which are never retried automatically.
- **State of the world:** The outbox fills up locally and is never sent. `/v1/sync/*` return fixed stubs.

## Output Format

Deliverable is a single PR containing:

- [ ] ADR-0006 with a scenario table (create, update, stale update, delete, duplicate op, edit after delete)
- [ ] Engine with one push-then-pull cycle triggered on unlock, on reconnect and manually
- [ ] Memory server double and tests: two engines converge on a new record through it
- [ ] Status indicator with `aria-live='polite'` announcements
- [ ] Tests written first (TDD), named after the behaviour and citing the PRD IDs above
- [ ] Docstrings / TSDoc for every new public symbol
- [ ] No drive-by changes unrelated to the goal

## Examples

**Test that should pass after this issue lands**
```ts
it("two devices converge on a new record through the server double", async () => {
  const server = new MemoryServer();
  const [a, b] = [device(server), device(server)];
  await a.store.put(entry({ id: "e1" }));
  await a.sync(); await b.sync();
  expect(await b.store.get("journal", "e1")).toBeDefined();
});
```

## Constraints

**Scope fence:** No database work and no conflict UI. Updates that conflict may simply surface as 'Needs your attention' until E04-I05. If you find yourself touching files well
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

`spec-decomposition`, `tracer-skeleton`, `sync`
