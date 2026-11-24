<!-- E02-I07 | title: feat(devices): approve a new device from an unlocked one with verified pairing -->

## Role

You are a senior full-stack engineer (TypeScript PWA and Python FastAPI) with applied-cryptography experience.

## Goal

Let a signed-in but keyless new device obtain the root key from an already unlocked device through a short-lived, human-verified pairing in which the server relays only ciphertext.

## Context

- **Parent epic:** #EPIC_02_NUMBER (Identity, keys and devices)
- **Predecessor issue(s):** #E02_I06_NUMBER (E02-I06: feat(devices): register device identities, sign every request and build Manage Devices). Each must be merged first.
- **SPEC section:** `docs/plans/relationship_communication_agent_prd.md` §4.3 [DEV-001 path A], §13.3, §7 (DeviceEnrollment)
- **Acceptance criteria advanced:** AC-19
- **Files involved:**
  - `src/devices/pairing.ts`: new protocol implementation for both sides
  - `src/ui/screens/devices/`: 'Add this device' and 'Approve a device' flows
  - `warmly/api/enrollment.py`, `supabase/migrations/`: real enrollment routes and table
  - `docs/adr/0005-device-identity-and-pairing.md`: complete the pairing section
- **Prior decisions** (full register in `git-issues/2026-11-24_SPEC_summary.md`):
  - D-07: the new device creates an ephemeral key pair and an enrollment challenge. Both devices display a 6-digit code derived from both public keys and the server challenge; the user confirms they match. Only then does the approving device encrypt the root key to the new device with HPKE (RFC 9180) and post the ciphertext for relay.
  - Use a maintained HPKE library built on WebCrypto, pinned exactly, or WebCrypto primitives directly if the ADR justifies it. No custom key-agreement scheme.
  - Challenges expire after 5 minutes, are single use and are bound to the owner. Approval requires an unlocked, non-revoked device with a valid request signature.
  - The server stores no plaintext root material at any point, including in logs and error bodies.
- **State of the world:** A second device can only join with the recovery key. Enrollment routes return stubs.

## Output Format

Deliverable is a single PR containing:

- [ ] Protocol module with tests for both roles using two in-memory devices
- [ ] Negative tests: expired challenge, reused challenge, mismatched code, substituted public key (server-in-the-middle), approval by a revoked device, approval across owners
- [ ] E2E with two browser contexts: pair, confirm codes, the new device unlocks and reads a record encrypted by the first
- [ ] Accessible flows: the code is readable by screen readers and enterable without a camera
- [ ] Tests written first (TDD), named after the behaviour and citing the PRD IDs above
- [ ] Docstrings / TSDoc for every new public symbol
- [ ] No drive-by changes unrelated to the goal

## Examples

**Test that should pass after this issue lands**
```ts
it("a relay that swaps the new device's public key changes the code (AC-19)", async () => {
  const { approver, joiner } = await startPairing({ relay: keySwappingRelay });
  expect(approver.code).not.toBe(joiner.code);
});
```

## Constraints

**Scope fence:** Pairing links one user's own devices only. It must be impossible to pair across accounts; do not add any invitation or sharing concept. If you find yourself touching files well
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
