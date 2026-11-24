<!-- E06-I05 | title: feat(deps): delete dependent Reflect sessions locally when a source entry changes -->

## Role

You are a senior TypeScript engineer working in this repo's `src/` PWA on the Reflect feature and its AI integration.

## Goal

Build the dependency invalidation engine: when a journal entry is edited or deleted, on this device or through sync, every Reflect session that cited it is deleted locally as an ordinary tombstone, on every device, with no AI call.

## Context

- **Parent epic:** #EPIC_06_NUMBER (Reflect: source-linked answers about your own history)
- **Predecessor issue(s):** #E06_I04_NUMBER (E06-I04: feat(reflect): answer questions with grounded, cited prose and session-only follow-ups). Each must be merged first.
- **SPEC section:** `docs/plans/relationship_communication_agent_prd.md` §5.3 [DEP-001..008], §5.2 [SYNC-006, SYNC-007], §3.3 [RF-011], §13.7
- **Acceptance criteria advanced:** AC-12, AC-17, AC-03
- **Files involved:**
  - `docs/adr/0010-dependency-invalidation.md`: new ADR
  - `src/domain/deps/index.ts`: new in-memory dependency index
  - `src/domain/deps/invalidate.ts`: new engine with a per-record-type rule registry
  - `src/sync/apply.ts`: run the engine after each applied page
  - `src/domain/events.ts`: subscribe to `journal.changed` and `journal.deleted`
- **Prior decisions** (full register in `git-issues/2026-11-24_SPEC_summary.md`):
  - D-13: there is no stored dependency record. Each derived record already carries its `SourceRef`s inside its own ciphertext, so the index is rebuilt in memory at unlock and kept current from store changes. One source of truth cannot drift between devices.
  - D-14: a Reflect session is deleted **whole** if any of its messages cites a changed or deleted entry. This is the PRD's preferred conservative policy; it never leaves a follow-up referring to a missing predecessor.
  - Invalidation is an idempotent pure function of local state: a derived record is stale when a cited entry is tombstoned or its current `contentHash` differs from the stored `sourceHash`. It runs on local edits and deletes, after every sync page, and once at unlock. Running it twice changes nothing.
  - Because each device applies the same rule to the same data, and deleting an already-deleted record is a no-op, the cascade converges whatever order operations arrive in (SYNC-007).
  - The engine exposes a registry so epic 07 can add card rules without changing the engine. It must never import from `src/ai/`; an architecture test enforces that.
  - The user is told, without private text: 'A reflection was removed because an entry it quoted was changed.'
- **State of the world:** Sessions store source references, and `journal.changed` / `journal.deleted` events fire, but nothing listens.

## Output Format

Deliverable is a single PR containing:

- [ ] ADR-0010 with the cascade diagram, the index and the engine
- [ ] Tests: edit, delete, feelings-only edit (no invalidation), stale record arriving by sync after the edit, engine run twice
- [ ] Architecture test: `src/domain/deps` has no dependency on `src/ai`
- [ ] E2E, two contexts: device A edits an entry while B is offline with a dependent session; after both sync, the session is gone on both and zero provider requests were made
- [ ] Tests written first (TDD), named after the behaviour and citing the PRD IDs above
- [ ] Docstrings / TSDoc for every new public symbol
- [ ] No drive-by changes unrelated to the goal

## Examples

**Test that should pass after this issue lands**
```ts
it("deletes the whole dependent session when a cited entry is edited (DEP-002, AC-12)", async () => {
  const s = await sessionCiting(entry.id);
  await editEntry(store, entry.id, { good: "changed" });
  expect(await store.get("reflect", s.id)).toBeUndefined();
  expect(await rawRecord(s.id)).toMatchObject({ tombstone: true });
  expect(fakeProvider.calls).toHaveLength(callsBefore);
});
```

## Constraints

**Scope fence:** Card rules are E07-I08. No message-level or subtree cascade. Never regenerate anything. If you find yourself touching files well
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
- [ ] PR body includes `Refs #EPIC_06_NUMBER` and `Closes` this issue's number.
- [ ] CI is green and the Claude reviewer's latest `Verdict:` on HEAD is `LGTM`.

## Labels

`spec-decomposition`, `core`, `reflect`
