<!-- E03-I08 | title: feat(journal): handle storage errors, suspend and resume, and the installed offline app -->

## Role

You are a senior TypeScript engineer working in this repo's `src/` PWA (Preact, IndexedDB, Vitest with fake-indexeddb).

## Goal

Make the journal fail safely when storage is full or unavailable, survive browser suspend and resume, and work as an installed PWA with the network off on both supported browsers.

## Context

- **Parent epic:** #EPIC_03_NUMBER (Offline journal)
- **Predecessor issue(s):** #E03_I07_NUMBER (E03-I07: feat(journal): search entries locally, case-insensitively and offline). Each must be merged first.
- **SPEC section:** `docs/plans/relationship_communication_agent_prd.md` §5.1 [SYNC-001], §11 AC-28, §3.6 [UI-008]
- **Acceptance criteria advanced:** AC-28, AC-02, AC-03
- **Files involved:**
  - `src/storage/errors.ts`: new typed storage errors
  - `src/ui/components/StatusBanner.tsx`: offline and storage status
  - `vite.config.ts`: precache check
  - `e2e/offline.spec.ts`: new
- **Prior decisions** (full register in `git-issues/2026-11-24_SPEC_summary.md`):
  - On `QuotaExceededError` or a blocked/failed database open, keep the text the user typed on screen, explain what happened and what to do next, and never drop data silently. Follow the `user-facing-error-messages` skill.
  - Request persistent storage (`navigator.storage.persist`) after onboarding and show the result honestly in Settings.
  - The service worker precaches the public app shell only. Add a test that the precache manifest and Cache Storage contain no user data and no API responses.
  - A status area shows 'Offline: your writing is saved on this device' without revealing any private text.
- **State of the world:** Happy paths work offline; storage failures surface as unhandled rejections.

## Output Format

Deliverable is a single PR containing:

- [ ] Typed errors and recovery UI for quota, blocked upgrade and unavailable IndexedDB
- [ ] Tests that inject each failure and assert that typed text is preserved
- [ ] E2E on both projects: load once, go offline, reload from the service worker, complete an entry
- [ ] E2E: simulated suspend (page hidden for more than 30 minutes) resumes to the locked screen with the draft intact
- [ ] Tests written first (TDD), named after the behaviour and citing the PRD IDs above
- [ ] Docstrings / TSDoc for every new public symbol
- [ ] No drive-by changes unrelated to the goal

## Examples

**Test that should pass after this issue lands**
```ts
it("keeps the typed text on screen when storage is full (AC-28)", async () => {
  failNextPutWith(new DOMException("full", "QuotaExceededError"));
  await user.click(saveButton);
  expect(goodField).toHaveValue("what I typed");
  expect(await screen.findByRole("alert")).toHaveTextContent(/couldn't save/i);
});
```

## Constraints

**Scope fence:** No sync status yet (E04-I01). Do not add runtime caching of any API response. If you find yourself touching files well
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
- [ ] PR body includes `Refs #EPIC_03_NUMBER` and `Closes` this issue's number.
- [ ] CI is green and the Claude reviewer's latest `Verdict:` on HEAD is `LGTM`.

## Labels

`spec-decomposition`, `edges`, `journal`
