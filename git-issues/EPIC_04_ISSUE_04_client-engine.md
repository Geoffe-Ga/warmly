<!-- E04-I04 | title: feat(sync): drain the outbox and apply remote changes reliably on the client -->

## Role

You are a senior TypeScript engineer working in this repo's `src/` PWA on the sync engine.

## Goal

Make the client engine production-grade against the real API: drain the outbox in order, apply pulled changes atomically, persist the cursor, back off on network errors, and stay correct across tabs, suspend and partial network loss.

## Context

- **Parent epic:** #EPIC_04_NUMBER (Encrypted multi-device sync)
- **Predecessor issue(s):** #E04_I03_NUMBER (E04-I03: feat(sync): serve the owner-scoped change feed with a stable cursor). Each must be merged first.
- **SPEC section:** `docs/plans/relationship_communication_agent_prd.md` §5.2 [SYNC-008, SYNC-010, SYNC-011]
- **Acceptance criteria advanced:** AC-16, AC-28
- **Files involved:**
  - `src/sync/engine.ts`: state machine, backoff, cursor persistence
  - `src/sync/apply.ts`: new: apply a page of changes in one IndexedDB transaction
  - `src/sync/scheduler.ts`: new triggers and Web Locks coordination
  - `e2e/sync.spec.ts`: new two-context tests against the real API and database
- **Prior decisions** (full register in `git-issues/2026-11-24_SPEC_summary.md`):
  - One engine runs per origin: use the Web Locks API so two tabs never push the same outbox entries concurrently.
  - Applying a page writes records, removes acknowledged outbox entries and advances the cursor in **one** IndexedDB transaction. A crash leaves either the old or the new state.
  - A remote change for a record with un-pushed local edits is not applied over them; it is parked for conflict handling (E04-I05).
  - Network failures retry with capped exponential backoff and jitter and reuse the same `op_id`. HTTP 4xx results are not retried blindly.
  - Device clocks are never used for ordering; only server revisions and sequences are (clock-skew requirement, SYNC-011).
- **State of the world:** The engine performs a naive single cycle that was only exercised against the memory server.

## Output Format

Deliverable is a single PR containing:

- [ ] Engine state machine with tests for: offline to online, response lost after the server applied (retry yields no duplicate), page crash mid-apply, two tabs, 401 mid-cycle
- [ ] Suspend test: a cycle interrupted by page freeze resumes without duplication
- [ ] Skewed-clock test: a device whose clock is a day off still converges
- [ ] E2E, two contexts against the real stack: create, edit and delete propagate; unrelated records sync while one is parked
- [ ] Tests written first (TDD), named after the behaviour and citing the PRD IDs above
- [ ] Docstrings / TSDoc for every new public symbol
- [ ] No drive-by changes unrelated to the goal

## Examples

**Test that should pass after this issue lands**
```ts
it("does not double-create when the response to a push is lost (SYNC-008)", async () => {
  transport.dropNextResponse();
  await a.sync();           // server applied, client never heard back
  await a.sync();           // retry with the same op_id
  expect(await server.count("journal")).toBe(1);
});
```

## Constraints

**Scope fence:** Conflict review UI is E04-I05; deletion edge rules are E04-I06. Do not add background sync through the service worker. If you find yourself touching files well
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
