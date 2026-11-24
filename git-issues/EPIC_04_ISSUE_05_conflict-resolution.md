<!-- E04-I05 | title: feat(sync): keep both conflicting versions and let the user resolve them locally -->

## Role

You are a senior full-stack engineer (TypeScript PWA and Python FastAPI on PostgreSQL) who has built offline-first sync.

## Goal

When two devices change one record from the same base revision, retain both ciphertexts, show the user both decrypted versions, and let them keep either or write a merge, after which the temporary variant is purged.

## Context

- **Parent epic:** #EPIC_04_NUMBER (Encrypted multi-device sync)
- **Predecessor issue(s):** #E04_I04_NUMBER (E04-I04: feat(sync): drain the outbox and apply remote changes reliably on the client). Each must be merged first.
- **SPEC section:** `docs/plans/relationship_communication_agent_prd.md` §5.2 [SYNC-004, SYNC-007, SYNC-010]
- **Acceptance criteria advanced:** AC-16, AC-05
- **Files involved:**
  - `supabase/migrations/`, `warmly/services/sync_write.py`: `record_conflicts` table and storing the losing ciphertext
  - `warmly/api/sync.py`: feed includes conflict variants; resolve operation
  - `src/sync/conflicts.ts`: new local conflict model
  - `src/ui/screens/sync/conflict-review.tsx`: new review screen
- **Prior decisions** (full register in `git-issues/2026-11-24_SPEC_summary.md`):
  - D-10: on a stale update the server stores the incoming ciphertext as a conflict variant linked to the record and returns `conflict`. The current revision is untouched. Variants appear in the owner's change feed so every device sees the conflict.
  - Resolution is an ordinary update whose `base_revision` is the current revision and which lists the variant IDs it resolves. On success the server deletes those variants in the same transaction.
  - Variants are owner-scoped and RLS-protected exactly like records (SYNC-007).
  - The review screen shows both versions side by side with which device and when (from local metadata), offers 'Keep this version', 'Keep the other' and 'Merge by hand', and applies the normal three-answer validation to the result.
  - A record in conflict stays readable (current server version) and is clearly marked. Nothing is discarded without the user's choice.
- **State of the world:** A stale update is rejected and the losing device's edit sits un-pushed, flagged as needing attention.

## Output Format

Deliverable is a single PR containing:

- [ ] Migration, write-path change and resolve path with tests, including a conflict on top of a conflict
- [ ] Client conflict model and review screen, keyboard and screen-reader usable
- [ ] Tests: variants purged after resolution; another owner can neither list nor resolve them
- [ ] E2E, two contexts: both edit offline, both sync, the user merges on one, both converge to the merged text
- [ ] Tests written first (TDD), named after the behaviour and citing the PRD IDs above
- [ ] Docstrings / TSDoc for every new public symbol
- [ ] No drive-by changes unrelated to the goal

## Examples

**Test that should pass after this issue lands**
```ts
it("keeps both versions until the user chooses (AC-16)", async () => {
  await editOffline(a, "e1", { good: "from A" });
  await editOffline(b, "e1", { good: "from B" });
  await a.sync(); await b.sync(); await a.sync();
  const c = await a.conflicts.for("e1");
  expect([c.current.good, c.variants[0].good].sort()).toEqual(["from A", "from B"]);
});
```

## Constraints

**Scope fence:** No automatic or field-level merging. Edit-versus-delete conflicts are E04-I06. If you find yourself touching files well
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
