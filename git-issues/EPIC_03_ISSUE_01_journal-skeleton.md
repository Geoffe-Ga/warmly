<!-- E03-I01 | title: feat(journal): wire compose, timeline, entry and search screens to an in-memory store -->

## Role

You are a senior TypeScript engineer working in this repo's `src/` PWA (Preact, IndexedDB, Vitest with fake-indexeddb).

## Goal

Make the whole journal flow navigable against an in-memory `RecordStore`: a compose form with the three prompts, a timeline, an entry view and a search box, each showing data from the fake store.

## Context

- **Parent epic:** #EPIC_03_NUMBER (Offline journal)
- **Predecessor issue(s):** #E02_I05_NUMBER (E02-I05: feat(security): add trusted-device unlock, manual lock and the 30-minute inactivity lock). Each must be merged first.
- **SPEC section:** `docs/plans/relationship_communication_agent_prd.md` §3.2 [JR-001], §7 (JournalEntry)
- **Acceptance criteria advanced:** AC-23
- **Files involved:**
  - `src/domain/journal/types.ts`: new `JournalEntry` type and prompt constants
  - `src/storage/record-store.ts`: new `RecordStore` interface plus `MemoryRecordStore`
  - `src/ui/screens/journal/`: compose, timeline, entry, search
  - `e2e/journal.spec.ts`: new
- **Prior decisions** (full register in `git-issues/2026-11-24_SPEC_summary.md`):
  - Prompts, verbatim and in this order: 'What's going well?', 'What would you like to improve?', 'Since your last journal entry, how has your partner helped you feel loved?' (JR-001).
  - `RecordStore` is typed by record kind and exposes `get`, `list`, `put`, `delete` and `subscribe`. Screens depend on the interface only.
  - `JournalEntry` fields: `id`, `createdAt`, `entryDate` with IANA timezone, `updatedAt`, `status: 'draft' | 'complete'`, `responses: { good, improve, loved }`, optional `feelings`, `contentHash`.
- **State of the world:** Journal routes are placeholders. No domain types or store exist.

## Output Format

Deliverable is a single PR containing:

- [ ] Types, interface, memory store and the four screens wired together
- [ ] Smoke tests: each screen renders seeded data in the right shape
- [ ] E2E: Home to Journal to compose to timeline to entry and back, with axe
- [ ] Tests written first (TDD), named after the behaviour and citing the PRD IDs above
- [ ] Docstrings / TSDoc for every new public symbol
- [ ] No drive-by changes unrelated to the goal

## Examples

**Test that should pass after this issue lands**
```ts
it("shows the three prompts in PRD order (JR-001)", () => {
  render(<Compose store={new MemoryRecordStore()} />);
  expect(screen.getAllByRole("textbox").map(labelOf)).toEqual(PROMPTS.map((p) => p.label));
});
```

## Constraints

**Scope fence:** No validation, persistence, encryption or search logic yet. Seed data must be obviously synthetic. If you find yourself touching files well
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

`spec-decomposition`, `tracer-skeleton`, `journal`
