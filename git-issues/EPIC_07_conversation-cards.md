<!-- EPIC_07 | title: epic: Prepare for a Conversation: collections and cards -->

## Epic Summary

Let a user turn selected journal entries into up to three thematic, fully editable conversation cards per request, learn why each phrase may help, write unlimited cards of their own, and read them one at a time or print them, privately and with no tracking. Covers PRD §12 step 7, §3.4 [CC-001..016] and the card rules in §5.3.

## Scope

**In scope:**
- Collections, manual cards, ordering and editing
- Presentation mode and print styles
- AI generation from explicitly selected entries
- Learning mode, segment provenance and 'Generate more options'
- Card ownership transition and card invalidation rules

**Out of scope:**
- Sharing, partner invitations, discussed-card state, presentation analytics (PRD §2.2)
- An automatic communication-style checker on edited text
- Post-conversation reflection (epic 08)

## Success Criteria

The epic is done when:

- [ ] A user can build a named collection of manual cards, reorder them, present them from card one and print them (AC-13, AC-14)
- [ ] Generation uses only the entries the user ticked and returns one to three validated cards (AC-10)
- [ ] Each highlighted segment shows its source or its inferred status, and alternatives need a separate explicit request (AC-11)
- [ ] Editing a generated card makes it user-owned; changing a source deletes unedited AI cards and strips stale annotations from user-owned ones (AC-12)
- [ ] All child issues are closed
- [ ] `./scripts/check-all.sh` and `./scripts/e2e.sh` pass on `main`

## Child Issues

Work them in this order. Each child lists its own predecessors.

- [ ] #E07_I01_NUMBER — Skeleton: feat(cards): wire collections, card editor, presentation and print screens to in-memory data
- [ ] #E07_I02_NUMBER — Core: feat(cards): create, rename, reorder and delete collections and manual cards
- [ ] #E07_I03_NUMBER — Core: feat(cards): present one card at a time with no tracking
- [ ] #E07_I04_NUMBER — Core: feat(cards): print a collection as clean card text
- [ ] #E07_I05_NUMBER — Core: feat(cards): generate one to three thematic cards from explicitly selected entries
- [ ] #E07_I06_NUMBER — Core: feat(cards): add learning mode with segment provenance and technique explanations
- [ ] #E07_I07_NUMBER — Core: feat(cards): generate alternative wordings for a segment on explicit request
- [ ] #E07_I08_NUMBER — Edges: feat(cards): make edited cards user-owned and apply card invalidation rules

## Sequencing Notes

**Blocked by:** epic 04 for I01 to I04 (manual cards need only storage and sync) and epics 05 and 06 for I05 to I08. I02 to I04 are therefore parallel-safe with epics 05 and 06.

## SPEC Reference

`docs/plans/relationship_communication_agent_prd.md` §12 step 7, §3.4 [CC-001..016], §5.3 [DEP-001, DEP-003, DEP-004], §7 (CardCollection, ConversationCard). Design decisions made during decomposition are
recorded in `git-issues/2026-11-24_SPEC_summary.md`.

## Labels

`epic`, `spec-decomposition`, `cards`
