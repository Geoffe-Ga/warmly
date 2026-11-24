<!-- E03-I03 | title: feat(journal): complete an entry with three required answers and an optional feelings check-in -->

## Role

You are a senior TypeScript engineer working in this repo's `src/` PWA (Preact, IndexedDB, Vitest with fake-indexeddb).

## Goal

Let a user complete a journal entry only when all three answers contain non-whitespace text, optionally record self-reported feelings, and store the completion metadata the PRD requires.

## Context

- **Parent epic:** #EPIC_03_NUMBER (Offline journal)
- **Predecessor issue(s):** #E03_I02_NUMBER (E03-I02: feat(storage): persist records as ciphertext in IndexedDB with migrations and an outbox). Each must be merged first.
- **SPEC section:** `docs/plans/relationship_communication_agent_prd.md` §3.2 [JR-002, JR-003, JR-005, JR-008]
- **Acceptance criteria advanced:** AC-01, AC-02
- **Files involved:**
  - `src/domain/journal/validation.ts`: new completion rules
  - `src/domain/journal/content-hash.ts`: new canonical hash
  - `src/domain/journal/feelings.ts`: new fixed feelings list
  - `src/ui/screens/journal/compose.tsx`: validation, helper text, feelings picker
- **Prior decisions** (full register in `git-issues/2026-11-24_SPEC_summary.md`):
  - Completion requires non-whitespace text in all three answers. Text such as 'Nothing comes to mind this week' counts. The UI says so next to the form. There is **no** Skip control (JR-002).
  - D-21 feelings list, multi-select and skippable: calm, happy, grateful, hopeful, loved, tired, sad, anxious, frustrated, lonely, overwhelmed. Plain words only; nothing clinical. The app never infers feelings from text (JR-003).
  - D-24: `contentHash` is SHA-256 over a canonical JSON of the three responses. Feelings are excluded, so changing them does not invalidate AI output later.
  - Record `createdAt`, `entryDate` with the device's IANA timezone, and `updatedAt`. Completing an entry makes no network request of any kind.
- **State of the world:** The compose screen saves whatever is typed, with no rules.

## Output Format

Deliverable is a single PR containing:

- [ ] Validation with field-level accessible errors (`aria-describedby`, focus moves to the first invalid field)
- [ ] Feelings picker usable by keyboard and screen reader
- [ ] Hash function with known-answer tests and a canonicalisation test (key order, Unicode normalisation)
- [ ] E2E: whitespace-only answer blocks completion; 'nothing to report' passes
- [ ] Tests written first (TDD), named after the behaviour and citing the PRD IDs above
- [ ] Docstrings / TSDoc for every new public symbol
- [ ] No drive-by changes unrelated to the goal

## Examples

**Test that should pass after this issue lands**
```ts
it.each(["", "   ", "\n\t"])("blocks completion when an answer is %j (AC-02)", (blank) => {
  expect(canComplete({ good: "ok", improve: blank, loved: "ok" })).toBe(false);
});
it("accepts an explicit 'nothing' answer (JR-002)", () => {
  expect(canComplete({ good: "Nothing comes to mind this week", improve: "x", loved: "y" })).toBe(true);
});
```

## Constraints

**Scope fence:** No sentiment analysis, no minimum length, no prompts that push the user to invent positives or negatives. Autosave is E03-I04. If you find yourself touching files well
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
- [ ] PR body includes `Refs #EPIC_03_NUMBER` and `Closes` this issue's number.
- [ ] CI is green and the Claude reviewer's latest `Verdict:` on HEAD is `LGTM`.

## Labels

`spec-decomposition`, `core`, `journal`
