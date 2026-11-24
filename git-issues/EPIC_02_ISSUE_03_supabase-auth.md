<!-- E02-I03 | title: feat(auth): integrate Supabase Auth and verify JWTs in FastAPI -->

## Role

You are a senior full-stack engineer (TypeScript PWA and Python FastAPI) with applied-cryptography experience.

## Goal

Replace `FakeAuthClient` with real email/password registration, email verification, sign-in, sign-out and password reset, and make every `/v1` route except health require a verified JWT whose subject becomes the owner.

## Context

- **Parent epic:** #EPIC_02_NUMBER (Identity, keys and devices)
- **Predecessor issue(s):** #E02_I01_NUMBER (E02-I01: feat(identity): wire the account state machine and onboarding, sign-in and lock screens with fakes); #E01_I05_NUMBER (E01-I05: feat(db): add the dev database stack, migration runner and deny-by-default baseline). Each must be merged first.
- **SPEC section:** `docs/plans/relationship_communication_agent_prd.md` §2.1 (accounts), §8, §4.2 [SEC-006]
- **Acceptance criteria advanced:** AC-01, AC-05
- **Files involved:**
  - `src/auth/supabase-auth-client.ts`: new real `AuthClient`
  - `warmly/auth/`: new JWT verification dependency and owner context
  - `warmly/api/`: apply the dependency to every router except health
  - `tests/api/test_auth.py`, `tests/frontend/auth/`: new tests
  - `index.html / CSP config`: add the Supabase Auth origin to `connect-src`
- **Prior decisions** (full register in `git-issues/2026-11-24_SPEC_summary.md`):
  - Use the auth-only Supabase client package, not the full client: the browser never calls the Data API (D-08).
  - Verify JWTs against the project's published signing keys (asymmetric). Check issuer, audience, expiry and `email_verified`. The owner ID is always the token subject, never a client-supplied field.
  - Tests sign tokens with a locally generated key pair; no test contacts a real Supabase project.
  - Auth errors shown to users must not reveal whether an email address is registered.
- **State of the world:** Screens work against `FakeAuthClient`. API routes accept anonymous requests.

## Output Format

Deliverable is a single PR containing:

- [ ] Real `AuthClient` behind the existing interface
- [ ] Backend dependency plus tests: missing, expired, wrong-issuer, wrong-audience, unverified-email and tampered tokens all return 401
- [ ] A test proving that an `owner_id` in a request body or query string is ignored
- [ ] Local dev instructions for running against the Supabase local stack
- [ ] Tests written first (TDD), named after the behaviour and citing the PRD IDs above
- [ ] Docstrings / TSDoc for every new public symbol
- [ ] No drive-by changes unrelated to the goal

## Examples

**Request/response**
```
GET /v1/devices            (no Authorization header)
401 Unauthorized
{ "type": "about:blank", "title": "Unauthorized", "code": "auth.missing_token" }
```

## Constraints

**Scope fence:** No social login, no magic links, no MFA. Do not make the password derive or unlock any key. If you find yourself touching files well
outside the list above, stop and check with the user.

**Needs a human:** Creating the development Supabase project and supplying its URL and publishable key. An agent must not create accounts, enter payment details or handle live secrets. Do everything else, then stop and report exactly what the human must do.

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

`spec-decomposition`, `core`, `identity`, `needs-human`
