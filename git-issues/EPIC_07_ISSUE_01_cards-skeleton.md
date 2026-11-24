<!-- E07-I01 | title: feat(cards): wire collections, card editor, presentation and print screens to in-memory data -->

## Role

You are a senior TypeScript engineer working in this repo's `src/` PWA on the conversation-cards feature.

## Goal

Make the whole Prepare flow navigable against in-memory data: the collections list, a collection's cards, a card editor, the presentation view and the print view.

## Context

- **Parent epic:** #EPIC_07_NUMBER (Prepare for a Conversation: collections and cards)
- **Predecessor issue(s):** #E04_I06_NUMBER (E04-I06: feat(sync): make deletion durable so stale devices cannot resurrect records). Each must be merged first.
- **SPEC section:** `docs/plans/relationship_communication_agent_prd.md` §3.4 [CC-001, CC-012], §7 (CardCollection, ConversationCard)
- **Acceptance criteria advanced:** AC-23
- **Files involved:**
  - `src/domain/cards/types.ts`: new `CardCollection`, `ConversationCard`, `CardSegment` types
  - `src/ui/screens/prepare/`: collections, collection, card, present and print screens
  - `e2e/cards.spec.ts`: new
- **Prior decisions** (full register in `git-issues/2026-11-24_SPEC_summary.md`):
  - `ConversationCard`: `id`, `collectionId`, `type`, `authorship: 'ai_generated' | 'user_owned'`, ordered `segments` (each with `id`, `category`, `text`, optional `evidence`, `evidenceKind`, `teachingExplanation`), `sourceEntryIds`, timestamps. A manual card is a `user_owned` card with plain segments and no AI fields.
  - `CardCollection`: `id`, `name`, ordered `cardIds`, timestamps.
  - Cards never store source excerpt text, only references (DEP-004).
  - 'Prepare for a Conversation' on Home opens the collections list.
- **State of the world:** Prepare routes are placeholders.

## Output Format

Deliverable is a single PR containing:

- [ ] Types and the five screens showing seeded synthetic data
- [ ] Smoke tests per screen
- [ ] E2E: Home to collections to a collection to a card to present to print, with axe
- [ ] Tests written first (TDD), named after the behaviour and citing the PRD IDs above
- [ ] Docstrings / TSDoc for every new public symbol
- [ ] No drive-by changes unrelated to the goal

## Examples

**Test that should pass after this issue lands**
```ts
it("lists seeded collections and opens one", async () => {
  render(<Collections store={seededMemoryStore()} />);
  await user.click(screen.getByRole("link", { name: "Sunday talk" }));
  expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Sunday talk");
});
```

## Constraints

**Scope fence:** No persistence, no AI, no print CSS beyond a placeholder. If you find yourself touching files well
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

`spec-decomposition`, `tracer-skeleton`, `cards`
