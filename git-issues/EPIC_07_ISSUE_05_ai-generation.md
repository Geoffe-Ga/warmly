<!-- E07-I05 | title: feat(cards): generate one to three thematic cards from explicitly selected entries -->

## Role

You are a senior TypeScript engineer working in this repo's `src/` PWA on the conversation-cards feature.

## Goal

Let a user tick journal entries, confirm the disclosure and receive one to three validated thematic cards built only from those entries, saved into the collection as AI-generated cards with provenance.

## Context

- **Parent epic:** #EPIC_07_NUMBER (Prepare for a Conversation: collections and cards)
- **Predecessor issue(s):** #E07_I04_NUMBER (E07-I04: feat(cards): print a collection as clean card text); #E06_I05_NUMBER (E06-I05: feat(deps): delete dependent Reflect sessions locally when a source entry changes). Each must be merged first.
- **SPEC section:** `docs/plans/relationship_communication_agent_prd.md` §3.4 [CC-001..004, CC-011], §6.2 [AI-009..012]
- **Acceptance criteria advanced:** AC-10, AC-26, AC-15
- **Files involved:**
  - `src/ui/screens/prepare/select-entries.tsx`: new explicit entry picker
  - `src/ai/prompts/cards.ts`: new prompt builder and policy text
  - `src/domain/cards/generate.ts`: new orchestration: select, disclose, call, ground, save
  - `tests/frontend/cards/generate.test.ts`: new
- **Prior decisions** (full register in `git-issues/2026-11-24_SPEC_summary.md`):
  - The picker starts with nothing selected. There is no 'select all recent', no automatic or suggested selection, and Generate is disabled until at least one entry is ticked (CC-001).
  - The request manifest contains exactly the ticked entries. A test asserts the request body contains no text from any other entry (CC-002).
  - The model is asked for one to three coherent themes and told not to pad. Zero cards or more than three fails validation; fewer than three is success (CC-002).
  - Policy text: combine related entries; preserve contradictions and distinct themes; include appreciation and evidence of change where present; never state the partner's intentions or feelings as fact; card types appreciation, need/request, curiosity or other (CC-003).
  - Each segment must satisfy the grounding rules from E05-I04. Accepted cards are stored `ai_generated` with `SourceRef`s. If the selected entries exceed the input budget, the user is asked to select fewer; nothing is silently dropped.
- **State of the world:** Collections hold manual cards only. The gateway, contracts and adapters exist.

## Output Format

Deliverable is a single PR containing:

- [ ] Entry picker, prompt builder (with golden tests) and orchestration
- [ ] Tests: only selected entries are sent; one-card and three-card responses accepted; zero and four rejected; a failure leaves the selection and the collection untouched
- [ ] E2E with the fake provider: select two entries, confirm, two cards appear in the collection
- [ ] Tests written first (TDD), named after the behaviour and citing the PRD IDs above
- [ ] Docstrings / TSDoc for every new public symbol
- [ ] No drive-by changes unrelated to the goal

## Examples

**Test that should pass after this issue lands**
```ts
it("sends only the entries the user ticked (CC-002, AC-10)", async () => {
  await generate({ selected: [entryA.id], collectionId }, token);
  const body = JSON.stringify(fakeProvider.lastRequest);
  expect(body).toContain(entryA.responses.good);
  expect(body).not.toContain(entryB.responses.good);
});
```

## Constraints

**Scope fence:** No learning-mode UI (E07-I06), no alternatives (E07-I07), no ownership logic (E07-I08). Never top up to three cards. If you find yourself touching files well
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
- [ ] PR body includes `Refs #EPIC_07_NUMBER` and `Closes` this issue's number.
- [ ] CI is green and the Claude reviewer's latest `Verdict:` on HEAD is `LGTM`.

## Labels

`spec-decomposition`, `core`, `cards`
