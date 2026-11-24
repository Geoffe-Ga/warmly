<!-- E07-I08 | title: feat(cards): make edited cards user-owned and apply card invalidation rules -->

## Role

You are a senior TypeScript engineer working in this repo's `src/` PWA on the conversation-cards feature.

## Goal

Implement card ownership and stale-source handling: the first saved edit makes a generated card user-owned, a source change deletes unedited AI cards, and user-owned cards keep their wording while losing stale AI annotations.

## Context

- **Parent epic:** #EPIC_07_NUMBER (Prepare for a Conversation: collections and cards)
- **Predecessor issue(s):** #E07_I07_NUMBER (E07-I07: feat(cards): generate alternative wordings for a segment on explicit request). Each must be merged first.
- **SPEC section:** `docs/plans/relationship_communication_agent_prd.md` §3.4 [CC-007, CC-008, CC-009], §5.3 [DEP-001, DEP-003, DEP-004, DEP-005]
- **Acceptance criteria advanced:** AC-12, AC-26
- **Files involved:**
  - `src/domain/cards/ownership.ts`: new edit and transition logic
  - `src/domain/cards/invalidation-rule.ts`: new rule registered with the engine from E06-I05
  - `docs/adr/0010-dependency-invalidation.md`: add the card rules
  - `src/ui/screens/prepare/card.tsx`: free editing of any segment and the whole card
- **Prior decisions** (full register in `git-issues/2026-11-24_SPEC_summary.md`):
  - D-15: **any** saved change to a card's text or segment structure makes it `user_owned`. This is the PRD's allowed conservative policy; it needs no judgement about what counts as 'substantive' and is trivially testable. Reordering cards in a collection or moving a card is not an edit.
  - On edit, the edited segment loses its evidence, `evidenceKind` and teaching explanation at once, because they described text that no longer exists. Untouched segments keep theirs.
  - Invalidation rule for a changed or deleted source entry: an `ai_generated` card that references it is deleted; a `user_owned` card keeps every word, and each segment referencing that source loses its evidence, `evidenceKind` and teaching explanation. `sourceEntryIds` is pruned.
  - No plaintext excerpt may remain in a preserved card. Cards hold references only, and stripped references are removed entirely (DEP-004).
  - Editing is unrestricted: any segment or the whole card can be rewritten, and no checker blocks or alters the user's wording (CC-006). The transition is one-way.
  - All of it is local, syncs as ordinary updates and tombstones, and calls no AI.
- **State of the world:** Cards can be generated, viewed in learning mode and given alternatives, but editing does not change ownership and source changes do not affect cards.

## Output Format

Deliverable is a single PR containing:

- [ ] Ownership logic and the invalidation rule, with ADR-0010 updated
- [ ] Tests: edit transitions ownership; unedited AI card deleted on source edit and on source delete; user-owned card survives with wording intact and annotations stripped; manual card untouched; rule is idempotent
- [ ] A scan test that a preserved card's stored payload contains no substring of the old source text
- [ ] E2E, two contexts: edit a source on A; on B an unedited card disappears and an edited one remains without highlights; zero provider requests
- [ ] Tests written first (TDD), named after the behaviour and citing the PRD IDs above
- [ ] Docstrings / TSDoc for every new public symbol
- [ ] No drive-by changes unrelated to the goal

## Examples

**Test that should pass after this issue lands**
```ts
it("keeps a user-owned card's wording but strips stale annotations (DEP-003, AC-12)", async () => {
  const card = await generatedCardFrom(entry);
  await editSegment(card.id, 0, "In my own words");
  await editEntry(store, entry.id, { good: "changed" });
  const after = await store.get("card", card.id);
  expect(after.authorship).toBe("user_owned");
  expect(after.segments[0].text).toBe("In my own words");
  expect(after.segments.every((s) => !s.evidence?.length && !s.teachingExplanation)).toBe(true);
});
```

## Constraints

**Scope fence:** Do not change the engine itself or the Reflect rule. No 'restore AI version', no revision history. If you find yourself touching files well
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

`spec-decomposition`, `edges`, `cards`
