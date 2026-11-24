<!-- E02-I01 | title: feat(identity): wire the account state machine and onboarding, sign-in and lock screens with fakes -->

## Role

You are a senior TypeScript engineer with applied-cryptography experience (WebCrypto), working in this repo's `src/` PWA.

## Goal

Make the whole account journey clickable end to end against in-memory fakes: register, verify, show and confirm a recovery key, unlock, lock, sign in, recover, with private routes unreachable unless the app is unlocked.

## Context

- **Parent epic:** #EPIC_02_NUMBER (Identity, keys and devices)
- **Predecessor issue(s):** #E01_I03_NUMBER (E01-I03: feat(ui): add light-theme design tokens and the accessible component kit); #E01_I04_NUMBER (E01-I04: feat(security): add CSP, security headers, log redaction and the network egress guard). Each must be merged first.
- **SPEC section:** `docs/plans/relationship_communication_agent_prd.md` §4.3 [DEV-005, DEV-006], §3.6 [UI-008]
- **Acceptance criteria advanced:** AC-01, AC-21, AC-23
- **Files involved:**
  - `src/app/session.ts`: new state machine: `signed_out`, `signed_in_locked`, `unlocked`
  - `src/auth/auth-client.ts`: new `AuthClient` interface plus `FakeAuthClient`
  - `src/crypto/key-vault.ts`: new `KeyVault` interface plus `FakeKeyVault`
  - `src/ui/screens/account/`: register, verify-email, recovery-key, sign-in, reset-password, recover, locked
  - `src/app/routes.ts`: mark private routes; add the route guard
- **Prior decisions** (full register in `git-issues/2026-11-24_SPEC_summary.md`):
  - Three explicit states. Private screens render only in `unlocked`. Locked screens show no private text, counts, titles or entry dates (UI-008).
  - Interfaces are the seam: later issues swap `FakeAuthClient` and `FakeKeyVault` for real implementations without touching screens.
  - The recovery-key screen requires the user to re-enter part of the key before continuing, and states plainly that losing every trusted device and the recovery key makes the data unrecoverable (DEV-006).
- **State of the world:** All screens are placeholders from epic 01. No session concept exists.

## Output Format

Deliverable is a single PR containing:

- [ ] State machine with exhaustive transition tests, including illegal transitions
- [ ] Screens wired to the fakes, with accessible validation and error states
- [ ] Route guard tests: every private route redirects when signed out or locked
- [ ] E2E: full onboarding happy path against fakes, with axe on each screen
- [ ] Tests written first (TDD), named after the behaviour and citing the PRD IDs above
- [ ] Docstrings / TSDoc for every new public symbol
- [ ] No drive-by changes unrelated to the goal

## Examples

**Test that should pass after this issue lands**
```ts
it("locking hides private routes without signing out (DEV-005)", () => {
  const s = unlockedSession();
  s.lock();
  expect(s.state).toBe("signed_in_locked");
  expect(canRender("/journal", s)).toBe(false);
});
```

## Constraints

**Scope fence:** No real Supabase calls and no real cryptography. Fakes must be impossible to bundle into a production build (assert this in a test). If you find yourself touching files well
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
- [ ] PR body includes `Refs #EPIC_02_NUMBER` and `Closes` this issue's number.
- [ ] CI is green and the Claude reviewer's latest `Verdict:` on HEAD is `LGTM`.

## Labels

`spec-decomposition`, `tracer-skeleton`, `identity`
