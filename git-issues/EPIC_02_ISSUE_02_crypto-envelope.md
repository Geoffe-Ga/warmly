<!-- E02-I02 | title: feat(crypto): implement the key hierarchy and versioned record envelope -->

## Role

You are a senior TypeScript engineer with applied-cryptography experience (WebCrypto), working in this repo's `src/` PWA.

## Goal

Implement the account root key, purpose-separated subkeys and the v1 authenticated record envelope on WebCrypto, with committed encrypted fixtures that every future format change must still decrypt.

## Context

- **Parent epic:** #EPIC_02_NUMBER (Identity, keys and devices)
- **Predecessor issue(s):** #E02_I01_NUMBER (E02-I01: feat(identity): wire the account state machine and onboarding, sign-in and lock screens with fakes). Each must be merged first.
- **SPEC section:** `docs/plans/relationship_communication_agent_prd.md` §4.2 [SEC-002, SEC-004], §10 [REL-004]
- **Acceptance criteria advanced:** AC-04
- **Files involved:**
  - `docs/adr/0003-key-hierarchy-and-envelope.md`: new ADR with a key-lifecycle diagram
  - `src/crypto/`: new: `root-key.ts`, `subkeys.ts`, `envelope.ts`, `encoding.ts`
  - `tests/frontend/crypto/`: unit tests and known-answer tests
  - `tests/fixtures/crypto/v1/`: new committed encrypted fixtures with their synthetic keys
- **Prior decisions** (full register in `git-issues/2026-11-24_SPEC_summary.md`):
  - D-03: WebCrypto only: AES-256-GCM, HKDF-SHA-256, `crypto.getRandomValues`. No WASM or hand-rolled primitives, which also keeps `wasm-unsafe-eval` out of the CSP.
  - D-03 nonce policy: each record gets its own key, `HKDF(root, info = purpose | recordId | formatVersion)`, and every encryption uses a fresh random 96-bit nonce. A nonce is never reused under one key, and no per-key message limit is approached.
  - AAD binds owner ID, record ID, record type and format version. Decryption fails if any of them differs.
  - Envelope layout: `formatVersion (1 byte) | nonce (12) | ciphertext+tag`. Unknown versions fail closed with a typed error.
  - The root key is generated client-side and is never sent to, or derivable by, the server. The account password never derives a key.
- **State of the world:** `KeyVault` exists only as a fake. No cryptographic code exists.

## Output Format

Deliverable is a single PR containing:

- [ ] ADR-0003 and the modules above with typed errors (`DecryptError`, `UnsupportedFormatError`)
- [ ] Tests: round trip; tampering with ciphertext, nonce, each AAD field or the version fails; two encryptions of one plaintext differ
- [ ] Fixture set v1 plus a test that decrypts every committed fixture version
- [ ] A note in the ADR on what automated tests do and do not prove (PRD §13.9)
- [ ] Tests written first (TDD), named after the behaviour and citing the PRD IDs above
- [ ] Docstrings / TSDoc for every new public symbol
- [ ] No drive-by changes unrelated to the goal

## Examples

**Test that should pass after this issue lands**
```ts
it("rejects a record replayed under another record ID (SEC-002)", async () => {
  const env = await seal(root, { owner, recordId: A, type: 1 }, plaintext);
  await expect(open(root, { owner, recordId: B, type: 1 }, env))
    .rejects.toBeInstanceOf(DecryptError);
});
```

## Constraints

**Scope fence:** No storage, recovery or device code. Do not add a crypto dependency; if WebCrypto cannot do something, stop and report. If you find yourself touching files well
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
- [ ] `pre-commit run --all-files` is clean: no skipped hooks, no bypassed checks.
- [ ] Public API changes are reflected in docstrings and user-facing docs.
- [ ] PR body includes `Refs #EPIC_02_NUMBER` and `Closes` this issue's number.
- [ ] CI is green and the Claude reviewer's latest `Verdict:` on HEAD is `LGTM`.

## Labels

`spec-decomposition`, `core`, `identity`
