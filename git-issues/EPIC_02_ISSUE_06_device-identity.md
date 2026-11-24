<!-- E02-I06 | title: feat(devices): register device identities, sign every request and build Manage Devices -->

## Role

You are a senior full-stack engineer (TypeScript PWA and Python FastAPI) with applied-cryptography experience.

## Goal

Give each device a registered cryptographic identity, require a valid device signature on every authenticated request, and show the user's own devices in Manage Devices with rename and a current-device marker.

## Context

- **Parent epic:** #EPIC_02_NUMBER (Identity, keys and devices)
- **Predecessor issue(s):** #E02_I05_NUMBER (E02-I05: feat(security): add trusted-device unlock, manual lock and the 30-minute inactivity lock). Each must be merged first.
- **SPEC section:** `docs/plans/relationship_communication_agent_prd.md` §4.3 [DEV-002, DEV-003, DEV-010], §4.2 [SEC-006], §8
- **Acceptance criteria advanced:** AC-05, AC-20
- **Files involved:**
  - `docs/adr/0005-device-identity-and-pairing.md`: new ADR; pairing section is completed by E02-I07
  - `src/devices/identity.ts`, `src/api/client.ts`: device key pair and request signing
  - `warmly/auth/device.py`, `warmly/api/devices.py`: signature verification dependency and real device routes
  - `supabase/migrations/`: `devices` table with owner-only RLS
  - `src/ui/screens/devices/`: Manage Devices list
- **Prior decisions** (full register in `git-issues/2026-11-24_SPEC_summary.md`):
  - D-06: each device holds a non-extractable ECDSA P-256 key. Every request carries the device ID and a signature over method, path, body SHA-256, a timestamp and a nonce. The server verifies it against the registered public key, rejects stale timestamps and replayed nonces, and checks that the device is not revoked. This keeps device authorization distinct from session authentication and makes a stolen JWT insufficient on its own.
  - Device display names are user content: encrypt them client-side as an envelope. The server stores ciphertext.
  - `GET /v1/devices` returns only the caller's devices. A device ID belonging to another owner returns 404, never 403, so IDs cannot be probed (DEV-010).
  - The first device registers itself during onboarding, once the root key exists.
- **State of the world:** Device routes return stubs. Requests are authenticated by JWT only.

## Output Format

Deliverable is a single PR containing:

- [ ] ADR-0005 (identity and request-signing sections)
- [ ] Client signing in the single API client; backend verification applied to every authenticated route
- [ ] Tests: missing, wrong-key, stale-timestamp, replayed-nonce and body-tampered requests are rejected; another owner's device ID returns 404
- [ ] Manage Devices: name, created, last successful sync (placeholder until epic 04), current-device marker, rename
- [ ] Tests written first (TDD), named after the behaviour and citing the PRD IDs above
- [ ] Docstrings / TSDoc for every new public symbol
- [ ] No drive-by changes unrelated to the goal

## Examples

**Request/response**
```
POST /v1/sync/operations
Authorization: Bearer <valid JWT for owner A>
X-Warmly-Device: <device id registered to owner B>
X-Warmly-Signature: <any>

401 Unauthorized
{ "code": "device.not_authorized" }
```

## Constraints

**Scope fence:** No approval of additional devices and no revocation yet. Do not accept an unsigned request on any authenticated route 'temporarily'. If you find yourself touching files well
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
