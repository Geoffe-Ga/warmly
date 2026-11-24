<!-- E08-I02 | title: feat(journal): add the optional post-conversation reflection -->

## Role

You are a senior TypeScript engineer working in this repo's `src/` PWA.

## Goal

Add a separate, optional, private form for reflecting after a conversation that the user opens deliberately, stored encrypted, shown in the timeline and search as its own kind, and included in Reflect context with clear provenance.

## Context

- **Parent epic:** #EPIC_08_NUMBER (Post-conversation reflection and release hardening)
- **Predecessor issue(s):** #E06_I05_NUMBER (E06-I05: feat(deps): delete dependent Reflect sessions locally when a source entry changes); #E07_I03_NUMBER (E07-I03: feat(cards): present one card at a time with no tracking). Each must be merged first.
- **SPEC section:** `docs/plans/relationship_communication_agent_prd.md` §3.5 [PC-001..004], §7 (PostConversationReflection)
- **Acceptance criteria advanced:** AC-03, AC-14, AC-06
- **Files involved:**
  - `src/domain/post-conversation/`: new types and service
  - `src/ui/screens/journal/post-conversation.tsx`: new form
  - `src/domain/search/index.ts`, `src/ui/screens/journal/timeline.tsx`: register the new kind
  - `src/domain/reflect/context.ts`, `src/ai/manifest.ts`: labelled inclusion in Reflect
- **Prior decisions** (full register in `git-issues/2026-11-24_SPEC_summary.md`):
  - Prompts, verbatim: 'What went well?', 'What felt difficult or unresolved?', 'What would you like to remember?'. All three are optional; saving requires at least one non-blank answer.
  - It is its own record type and is never presented as, or converted to, a standard journal entry (PC-003). The timeline labels it 'After a conversation'.
  - It is reached from the Journal area by an explicit action. Leaving presentation mode must not open it, suggest it or badge it (PC-002); an E2E test asserts this.
  - D-22: Reflect includes these records as evidence blocks labelled `post_conversation`, with response keys `went_well`, `difficult` and `remember`, so the model cannot mistake them for answers to the three journal prompts. They take part in dependency invalidation like journal entries.
  - No agreements, outcomes, ratings or links to specific cards are recorded.
- **State of the world:** Only standard journal entries exist. Search and Reflect context are already generic over document kinds.

## Output Format

Deliverable is a single PR containing:

- [ ] Types, service, form, timeline and search integration
- [ ] `SourceRef.responseKey` extended, with contract and grounding tests updated
- [ ] Tests: edit and delete invalidate dependent Reflect sessions; a blank form cannot be saved
- [ ] E2E: close presentation mode and confirm no post-conversation prompt appears; create one deliberately and find it by search
- [ ] Tests written first (TDD), named after the behaviour and citing the PRD IDs above
- [ ] Docstrings / TSDoc for every new public symbol
- [ ] No drive-by changes unrelated to the goal

## Examples

**Test that should pass after this issue lands**
```ts
it("labels post-conversation evidence so it is not read as a journal answer (PC-004)", () => {
  const prompt = buildReflectPrompt([journalEntry, postConversation], "how did it go?", session);
  expect(blockFor(prompt, postConversation.id)).toMatchObject({ kind: "post_conversation" });
  expect(blockFor(prompt, postConversation.id).responses).toHaveProperty("went_well");
});
```

## Constraints

**Scope fence:** No reminders, no link from the presentation view, no shared notes, no metrics. If you find yourself touching files well
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
- [ ] PR body includes `Refs #EPIC_08_NUMBER` and `Closes` this issue's number.
- [ ] CI is green and the Claude reviewer's latest `Verdict:` on HEAD is `LGTM`.

## Labels

`spec-decomposition`, `core`, `release`
