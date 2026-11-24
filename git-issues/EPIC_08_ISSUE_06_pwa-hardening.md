<!-- E08-I06 | title: test(pwa): harden install, offline, suspend and update behaviour on both supported browsers -->

## Role

You are a senior TypeScript engineer working in this repo's `src/` PWA.

## Goal

Prove with end-to-end tests that the complete app installs, works offline, survives suspend and resume, handles storage pressure and updates safely on mobile Safari and a modern desktop browser, and fix what fails.

## Context

- **Parent epic:** #EPIC_08_NUMBER (Post-conversation reflection and release hardening)
- **Predecessor issue(s):** #E07_I08_NUMBER (E07-I08: feat(cards): make edited cards user-owned and apply card invalidation rules); #E08_I02_NUMBER (E08-I02: feat(journal): add the optional post-conversation reflection). Each must be merged first.
- **SPEC section:** `docs/plans/relationship_communication_agent_prd.md` §11 AC-28, §8 (PWA updates), §3.6 [UI-003]
- **Acceptance criteria advanced:** AC-28, AC-02
- **Files involved:**
  - `e2e/pwa/`: new suite: install, offline, suspend, quota, update
  - `vite.config.ts`, `public/`: manifest and service-worker corrections
  - `docs/support/browsers.md`: new supported-browser statement
  - `scripts/typescript/`: bundle-size budget check
- **Prior decisions** (full register in `git-issues/2026-11-24_SPEC_summary.md`):
  - Supported: the two most recent major versions of Safari on iOS and of Chrome, Edge, Firefox and Safari on desktop. State it in the docs and in an in-app unsupported-browser notice.
  - Playwright's WebKit is the automated stand-in for mobile Safari. Say plainly in the docs that it is not a real iPhone and list what must be checked by hand before launch (install to Home Screen, storage eviction, passkey unlock).
  - The offline suite walks every feature that must work offline: write, draft, edit, delete, search, read and edit cards, present, print.
  - Performance budget: initial JavaScript under a stated compressed size and unlock-to-timeline under a stated time for 2,000 entries; both enforced in CI.
  - No runtime caching of API responses is added to achieve any of this.
- **State of the world:** Individual features have their own offline tests. Nothing exercises the installed app as a whole across both browsers.

## Output Format

Deliverable is a single PR containing:

- [ ] The PWA suite on both projects
- [ ] Fixes for every failure found, or a filed issue with an expected-failure test where a fix is out of scope
- [ ] Bundle and timing budgets in CI
- [ ] Browser support document including the manual pre-launch checklist
- [ ] Tests written first (TDD), named after the behaviour and citing the PRD IDs above
- [ ] Docstrings / TSDoc for every new public symbol
- [ ] No drive-by changes unrelated to the goal

## Examples

**Test that should pass after this issue lands**
```ts
test("every offline-required feature works with the network off (AC-28)", async ({ page, context }) => {
  await onboardAndSeed(page);
  await context.setOffline(true);
  await page.reload();
  for (const step of OFFLINE_JOURNEY) await step(page);   // write, draft, edit, delete, search, cards, present
  expect(await unhandledErrors(page)).toEqual([]);
});
```

## Constraints

**Scope fence:** No native wrapper, no push notifications, no background sync. If you find yourself touching files well
outside the list above, stop and check with the user.

**Needs a human:** Running the short manual checklist on a physical iPhone before launch. An agent must not create accounts, enter payment details or handle live secrets. Do everything else, then stop and report exactly what the human must do.

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
- [ ] PR body includes `Refs #EPIC_08_NUMBER` and `Closes` this issue's number.
- [ ] CI is green and the Claude reviewer's latest `Verdict:` on HEAD is `LGTM`.

## Labels

`spec-decomposition`, `edges`, `release`, `needs-human`
