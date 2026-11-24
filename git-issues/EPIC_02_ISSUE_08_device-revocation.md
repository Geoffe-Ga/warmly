<!-- E02-I08 | title: feat(devices): revoke a device and handle rejection on the revoked client -->

## Role

You are a senior full-stack engineer (TypeScript PWA and Python FastAPI) with applied-cryptography experience.

## Goal

Let a user revoke any of their devices after re-authenticating, make the server refuse that device immediately and permanently, and make the revoked client fail safely when it next connects.

## Context

- **Parent epic:** #EPIC_02_NUMBER (Identity, keys and devices)
- **Predecessor issue(s):** #E02_I07_NUMBER (E02-I07: feat(devices): approve a new device from an unlocked one with verified pairing). Each must be merged first.
- **SPEC section:** `docs/plans/relationship_communication_agent_prd.md` §4.3 [DEV-003, DEV-004, DEV-010]
- **Acceptance criteria advanced:** AC-20, AC-05
- **Files involved:**
  - `warmly/api/devices.py`, `warmly/services/`: real `POST /v1/devices/{id}/revoke`
  - `supabase/migrations/`: append-only revocation ledger
  - `src/ui/screens/devices/`: revoke confirmation and the 'this device was revoked' screen
  - `src/api/client.ts`: handle `device.revoked` centrally
- **Prior decisions** (full register in `git-issues/2026-11-24_SPEC_summary.md`):
  - Revocation requires a `ConfirmDialog` and fresh password re-authentication (DEV-003).
  - The server marks the device revoked, records it in an append-only ledger and signs out that device's auth session where the provider supports it. A revoked device ID can never be re-activated; rejoining means a new enrollment.
  - On `device.revoked` the client locks, stops syncing, deletes its wrapped root key and device key, and shows an explanation. It must not delete unsynced local ciphertext silently; say what remains on the device.
  - The confirmation states the caveat honestly: an offline revoked device keeps its local copy, and remote wipe is not promised (DEV-004).
  - Revoking the current device is allowed and ends in the signed-out state without rendering private data.
- **State of the world:** Devices can be registered, listed, renamed and paired. The revoke route is a stub.

## Output Format

Deliverable is a single PR containing:

- [ ] Endpoint, ledger migration and re-authentication check
- [ ] Tests: a revoked device with a still-valid JWT and correct signature gets 401 `device.revoked` on every route; it cannot re-register the same ID; another owner cannot revoke it
- [ ] E2E with two contexts: revoke B from A; B's next request lands on the revoked screen
- [ ] E2E: revoke the current device
- [ ] Tests written first (TDD), named after the behaviour and citing the PRD IDs above
- [ ] Docstrings / TSDoc for every new public symbol
- [ ] No drive-by changes unrelated to the goal

## Examples

**Request/response**
```
POST /v1/sync/operations      (device revoked 1 second ago, JWT still valid)
401 Unauthorized
{ "code": "device.revoked" }
```

## Constraints

**Scope fence:** No remote wipe, no notifications to other devices, and no rate limiting here (E04-I07). If you find yourself touching files well
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

`spec-decomposition`, `edges`, `identity`
