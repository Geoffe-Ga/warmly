<!-- E03-I07 | title: feat(journal): search entries locally, case-insensitively and offline -->

## Role

You are a senior TypeScript engineer working in this repo's `src/` PWA (Preact, IndexedDB, Vitest with fake-indexeddb).

## Goal

Let a user find entries by typing words, matched case-insensitively against decrypted text held in memory, with results that open the original entry and no query or index ever leaving memory.

## Context

- **Parent epic:** #EPIC_03_NUMBER (Offline journal)
- **Predecessor issue(s):** #E03_I06_NUMBER (E03-I06: feat(journal): permanently delete an entry with confirmation and a local tombstone). Each must be merged first.
- **SPEC section:** `docs/plans/relationship_communication_agent_prd.md` §3.2 [JR-010], §4.2 [SEC-007]
- **Acceptance criteria advanced:** AC-06, AC-03
- **Files involved:**
  - `src/domain/search/tokenize.ts`, `index.ts`: new tokenizer and in-memory index
  - `src/ui/screens/journal/search.tsx`: real search UI
  - `tests/frontend/search/`: new
- **Prior decisions** (full register in `git-issues/2026-11-24_SPEC_summary.md`):
  - D-12: the index is built in memory after unlock, updated on store changes, dropped on lock and **never** persisted. Queries are never placed in the URL, storage or logs.
  - Tokenisation: Unicode NFKC, case folding, split on non-letter/number, all query tokens must match (AND), prefix match on the last token. No stemming and no fuzzy matching in the MVP.
  - The index is generic over 'searchable documents' so post-conversation reflections can register later (E08-I02).
  - Results show the entry date and a short match snippet, and are a list of links to the entry route.
- **State of the world:** The search screen filters seed data with a naive substring check.

## Output Format

Deliverable is a single PR containing:

- [ ] Tokenizer and index with table-driven tests (case, accents, punctuation, emoji, empty query)
- [ ] Result list with an empty state and an `aria-live` result count
- [ ] Performance test: 2,000 synthetic entries index in under 500 ms and query in under 50 ms on CI
- [ ] E2E offline: search finds an entry and opens it
- [ ] Tests written first (TDD), named after the behaviour and citing the PRD IDs above
- [ ] Docstrings / TSDoc for every new public symbol
- [ ] No drive-by changes unrelated to the goal

## Examples

**Test that should pass after this issue lands**
```ts
it("matches case-insensitively and opens the source entry (JR-010)", () => {
  index.add(entry({ id: "e1", good: "We cooked DINNER together" }));
  expect(index.search("dinner")).toEqual([expect.objectContaining({ id: "e1" })]);
});
```

## Constraints

**Scope fence:** No vector search, relevance model, saved searches or server-side search (PRD §2.2). If you find yourself touching files well
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
