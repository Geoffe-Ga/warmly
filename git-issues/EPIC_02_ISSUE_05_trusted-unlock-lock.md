<!-- E02-I05 | title: feat(security): add trusted-device unlock, manual lock and the 30-minute inactivity lock -->

## Role

You are a senior TypeScript engineer with applied-cryptography experience (WebCrypto), working in this repo's `src/` PWA.

## Goal

Let an enrolled device unlock without the recovery key, lock on demand and lock automatically after 30 minutes of inactivity, clearing decrypted secrets from memory and hiding private UI without losing unsaved work.

## Context

- **Parent epic:** #EPIC_02_NUMBER (Identity, keys and devices)
- **Predecessor issue(s):** #E02_I04_NUMBER (E02-I04: feat(crypto): create, confirm, use and rotate the personal recovery key). Each must be merged first.
- **SPEC section:** `docs/plans/relationship_communication_agent_prd.md` §4.3 [DEV-005], §13.2
- **Acceptance criteria advanced:** AC-21
- **Files involved:**
  - `docs/adr/0004-trusted-device-unlock.md`: new ADR including a mobile Safari support matrix
  - `src/crypto/device-vault.ts`: new real `KeyVault`
  - `src/app/inactivity.ts`: new inactivity timer
  - `src/app/session.ts`: lock and unlock transitions, pre-lock flush hook
  - `src/ui/screens/account/locked.tsx`: unlock UI
- **Prior decisions** (full register in `git-issues/2026-11-24_SPEC_summary.md`):
  - D-05: the root key is stored at rest wrapped twice: by a **non-extractable** WebCrypto key held in IndexedDB, and by an unlock secret. The unlock secret comes from a WebAuthn passkey with the PRF extension where the browser supports it, otherwise from a device passphrase stretched with PBKDF2-HMAC-SHA-256 at the current OWASP iteration count.
  - Nothing that can decrypt is ever written to `localStorage` (SYNC-001).
  - Locking drops every in-memory key and decrypted record, then routes to the locked screen. Before dropping keys it awaits registered flush hooks, so a draft being edited is encrypted and saved first.
  - Inactivity is measured from the last user input, using wall-clock time checked on `visibilitychange`, so a suspended tab locks on resume.
  - Say 'cleared to the extent the browser allows'. Do not promise process-memory erasure or secure-enclave behaviour.
- **State of the world:** After onboarding the root key lives only in memory; reloading the page forces recovery.

## Output Format

Deliverable is a single PR containing:

- [ ] ADR-0004 with the support matrix and the documented fallback
- [ ] Real vault behind `KeyVault`, with wrong-secret and corrupted-store tests
- [ ] Timer tests with fake timers: locks at 30:00, not at 29:59; input resets it; resume after suspend locks
- [ ] Test that a registered flush hook completes before keys are dropped
- [ ] E2E: manual lock from any private screen hides content and removes it from the DOM
- [ ] Tests written first (TDD), named after the behaviour and citing the PRD IDs above
- [ ] Docstrings / TSDoc for every new public symbol
- [ ] No drive-by changes unrelated to the goal

## Examples

**Test that should pass after this issue lands**
```ts
it("locks at 30 minutes of inactivity and not before (AC-21)", () => {
  vi.advanceTimersByTime(30 * 60_000 - 1);
  expect(session.state).toBe("unlocked");
  vi.advanceTimersByTime(1);
  expect(session.state).toBe("signed_in_locked");
});
```

## Constraints

**Scope fence:** If neither passkey PRF nor the passphrase fallback works on mobile Safari, stop and report a blocker rather than weakening the design. No draft feature here; only the flush hook. If you find yourself touching files well
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

`spec-decomposition`, `core`, `identity`
