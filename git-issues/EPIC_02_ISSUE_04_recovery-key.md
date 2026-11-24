<!-- E02-I04 | title: feat(crypto): create, confirm, use and rotate the personal recovery key -->

## Role

You are a senior full-stack engineer (TypeScript PWA and Python FastAPI) with applied-cryptography experience.

## Goal

Let a user generate a recovery key at onboarding, confirm they stored it, recover their root key on a fresh device with it, and rotate it, while the server only ever holds a wrapped envelope.

## Context

- **Parent epic:** #EPIC_02_NUMBER (Identity, keys and devices)
- **Predecessor issue(s):** #E02_I02_NUMBER (E02-I02: feat(crypto): implement the key hierarchy and versioned record envelope); #E02_I03_NUMBER (E02-I03: feat(auth): integrate Supabase Auth and verify JWTs in FastAPI). Each must be merged first.
- **SPEC section:** `docs/plans/relationship_communication_agent_prd.md` §4.2 [SEC-003], §4.3 [DEV-001 path B, DEV-006], §7 (RecoveryEnvelope)
- **Acceptance criteria advanced:** AC-01, AC-18
- **Files involved:**
  - `src/crypto/recovery.ts`: new: generate, encode, parse, wrap, unwrap
  - `src/ui/screens/account/`: recovery-key, recover and rotate screens
  - `warmly/api/recovery.py`, `supabase/migrations/`: real `GET|PUT /v1/recovery-envelope` and its table
  - `tests/fixtures/crypto/v1/`: add recovery-envelope fixtures
- **Prior decisions** (full register in `git-issues/2026-11-24_SPEC_summary.md`):
  - D-04: the recovery key is a 256-bit random secret shown in grouped, checksummed base32. Because it is high entropy, the wrapping key is `HKDF(secret)` with AES-256-GCM. No password KDF is needed, which PRD §4.2 explicitly allows.
  - The server stores the wrapped root key, format version and non-secret parameters only. It never sees the recovery secret.
  - Rotation re-wraps the same root key under a new secret and replaces the envelope atomically. Existing records stay readable, and the old key stops working.
  - A password reset changes nothing about key material (AC-18).
- **State of the world:** Root key and envelope code exist. The recovery screens use the fake vault. The recovery endpoint returns a stub.

## Output Format

Deliverable is a single PR containing:

- [ ] Recovery module with typo detection through the checksum and a clear, non-blaming error
- [ ] Endpoint and migration with owner-only RLS, compare-and-swap on envelope version, and tests for cross-owner access
- [ ] E2E: onboard, sign in on a second browser context, recover with the key, see the same root-key fingerprint
- [ ] E2E: reset the password, sign in on a fresh context without the key, confirm nothing can be decrypted
- [ ] Rotation tests, including an interrupted rotation leaving the old key valid
- [ ] Tests written first (TDD), named after the behaviour and citing the PRD IDs above
- [ ] Docstrings / TSDoc for every new public symbol
- [ ] No drive-by changes unrelated to the goal

## Examples

**Test that should pass after this issue lands**
```ts
it("password reset alone cannot unwrap the root key (AC-18)", async () => {
  const { envelope } = await onboard();
  await auth.resetPassword(newPassword);
  await expect(unwrapWithPassword(envelope, newPassword)).rejects.toThrow();
});
```

## Constraints

**Scope fence:** No device-to-device approval (E02-I07) and no trusted-device unlock (E02-I05). Never log, persist or put the recovery secret in a URL. If you find yourself touching files well
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
