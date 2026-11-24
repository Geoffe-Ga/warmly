<!-- E05-I03 | title: feat(ai): store provider credentials encrypted and sync them between the user's devices -->

## Role

You are a senior TypeScript engineer working in this repo's `src/ai/` module, experienced with LLM APIs and structured output.

## Goal

Let a user choose a provider and add, replace or delete their API key, stored as an encrypted record that syncs only to their own authorised devices and never appears in logs, URLs or plain storage.

## Context

- **Parent epic:** #EPIC_05_NUMBER (AI provider layer and the BYOK compatibility gate)
- **Predecessor issue(s):** #E05_I02_NUMBER (E05-I02: docs(ai): run the browser BYOK compatibility and security review and record ADR-0007); #E04_I06_NUMBER (E04-I06: feat(sync): make deletion durable so stale devices cannot resurrect records). Each must be merged first.
- **SPEC section:** `docs/plans/relationship_communication_agent_prd.md` §4.2 [SEC-004, SEC-009], §7 (AccountSettings)
- **Acceptance criteria advanced:** AC-22, AC-05
- **Files involved:**
  - `src/domain/settings/`: new `AccountSettings` and `ProviderCredential` record types
  - `src/ai/credentials.ts`: new credential service
  - `src/ui/screens/settings/ai-provider.tsx`: add, replace, delete and 'Test connection'
  - `e2e/ai-credentials.spec.ts`: new two-context test
- **Prior decisions** (full register in `git-issues/2026-11-24_SPEC_summary.md`):
  - A credential is an ordinary encrypted record with its own type, so it inherits owner-only access, conflict handling and tombstones from epic 04.
  - The key is decrypted only at the moment of a gateway call and is never held in component state, the DOM after entry, a URL, `localStorage`, an error message or a log line.
  - After saving, the UI shows only the provider and the last four characters.
  - 'Test connection' calls `validateConfig` and is an explicit user action behind the same disclosure pattern. Saving a key does not test it automatically.
  - Deleting a credential is a tombstone, so it disappears from every device.
- **State of the world:** Settings shows provider status from the fake. There is nowhere to enter a key.

## Output Format

Deliverable is a single PR containing:

- [ ] Record types, service and UI with accessible forms
- [ ] Tests: canary key absent from IndexedDB plaintext scan, request bodies to the Warmly API, and captured logs
- [ ] E2E, two contexts: add on A, appears on B after sync; replace on B; delete on A removes it on B
- [ ] Test that a second account cannot obtain the first account's credential record
- [ ] Tests written first (TDD), named after the behaviour and citing the PRD IDs above
- [ ] Docstrings / TSDoc for every new public symbol
- [ ] No drive-by changes unrelated to the goal

## Examples

**Test that should pass after this issue lands**
```ts
it("never exposes the provider key outside the gateway call (AC-22)", async () => {
  await credentials.save("anthropic", "sk-CANARY-1234");
  expect(await dumpAllObjectStores()).not.toContain("sk-CANARY");
  expect(capturedWarmlyApiBodies.join("")).not.toContain("sk-CANARY");
  expect(screen.getByText(/1234/)).toBeVisible();
  expect(screen.queryByText(/sk-CANARY/)).toBeNull();
});
```

## Constraints

**Scope fence:** One key per provider and one active provider. No model picker, no organisation or team keys, no key sharing. If you find yourself touching files well
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
- [ ] PR body includes `Refs #EPIC_05_NUMBER` and `Closes` this issue's number.
- [ ] CI is green and the Claude reviewer's latest `Verdict:` on HEAD is `LGTM`.

## Labels

`spec-decomposition`, `core`, `ai`
